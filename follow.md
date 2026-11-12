# Execution flow

Live map of how the code runs. It always matches the current code. Current scope: the **web app** (`apps/web`, sections 7–10) and the **backend** (`apps/server`, sections 1–6). The backend has real providers (OpenAI speech-to-text, Anthropic Claude) and mock providers.

## 1. Entry point

| What             | How it starts                                                                                                                 | File / function                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Dev (both)       | `pnpm dev` (root). This runs every `apps/*` `dev` script in parallel: `tsx watch src/index.ts` (server) + `vite` (web, :5173) | server: `apps/server/src/index.ts`, then `main()`; web: see section 7                     |
| Server, no watch | `pnpm --filter @voice-agent/server start`                                                                                     | same                                                                                      |
| Tests            | `pnpm test`. This runs `vitest run` in each app                                                                               | `apps/server/test/*.test.ts` (call `test/helpers.ts:makeApp()`), `apps/web/src/*.test.ts` |

## 2. Execution order: server boot

1. `index.ts` top level runs `dotenv.config()`, which loads `<repo root>/.env` into `process.env` (if the file exists).
2. `index.ts:main()` runs:
   1. `config.ts:loadConfig(process.env)`. It drops empty values, then validates with the Zod `EnvSchema`, and checks that the API key for each chosen provider is present. **Any problem: throws, prints every bad var, exits 1.**
   2. `services/stt/index.ts:createSttProvider(config)` picks a provider from `STT_PROVIDER`: `openai` gives an `OpenAiSttProvider`, which builds an OpenAI SDK client with `maxRetries: 1` and `timeout: REQUEST_TIMEOUT_MS`; `mock` gives a `MockSttProvider`; `deepgram` throws "not implemented yet".
   3. `services/llm/index.ts:createLlmProvider(config)` picks a provider from `LLM_PROVIDER`: `anthropic` gives an `AnthropicLlmProvider`, which builds an Anthropic SDK client with `maxRetries: 1`; `mock` gives a `MockLlmProvider`.
   4. `app.ts:buildApp({ config, stt, llm })`:
      - creates the Fastify app (pino logger, `requestTimeout`)
      - registers plugins in order: **CORS**, then **rate-limit** (per IP, per minute), then **multipart** (upload limits)
      - `setErrorHandler`, which uses `errors.ts:toPublicError`
      - `setNotFoundHandler` (JSON 404)
      - `routes/health.ts:registerHealthRoute(app)`
      - `routes/ask.ts:registerAskRoute(app, deps)`
   5. Registers SIGINT/SIGTERM handlers, which call `app.close()` and then exit.
   6. `app.listen({ host, port })` (default `127.0.0.1:8787`).

## 3. Execution order: one `POST /api/ask` request

```
browser ──multipart──▶ Fastify
  onRequest hooks:  cors  →  rate-limit (429 if over the limit)
  handler (routes/ask.ts):
    readUpload(request)                     ← reads every multipart part
      └ part.toBuffer()                     ← audio held in memory only
      └ parseHistory(raw)  → HistorySchema.safeParse (shared)
    size check (< 1024 B → 400)
    capHistory(history, MAX_HISTORY_MESSAGES)        (history.ts)
    signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    callProvider(… stt.transcribe(audio, {mimeType, language, signal}))
      └ .trim()  → empty → 422
    callProvider(… llm.answer(history, transcript, {signal}))
    return { transcript, answer, timingMs }  → 200 JSON
    finally: request.log.info('ask finished', {sizes, ms, status})
  on any throw → setErrorHandler → toPublicError → { error } with status
```

Step by step:

1. **CORS hook** adds `Access-Control-Allow-Origin: CORS_ORIGIN`. A preflight `OPTIONS` request is answered here with 204.
2. **Rate-limit hook**: past `RATE_LIMIT_PER_MIN` requests from the same IP it throws a 429, and the error handler replies "Too many requests".
3. **`ask.ts` handler** starts and calls **`readUpload(request)`**:
   - loops over `request.parts()` (async iterator from `@fastify/multipart`)
   - file part: `part.toBuffer()`. If it is over 10 MB the plugin throws `FST_REQ_FILE_TOO_LARGE`, which becomes a 413. A field name other than `audio` gives a 400.
   - `history` field: a truncated value gives a 400
   - no audio gives a 400, and a MIME type that isn't `audio/*` or `video/*` gives a 400
   - **`parseHistory(raw)`**: missing or blank means `[]`. `JSON.parse` fails → 400. `HistorySchema` fails → 400.
4. Audio < 1024 bytes → `ApiError(400, "Recording too short…")`.
5. **`capHistory`** keeps the last N messages and drops leading assistant turns.
6. The route creates **one `AbortSignal`** for the whole remaining pipeline.
7. **`callProvider` → `stt.transcribe`**. If the provider throws: signal aborted → 504, otherwise → 502 "Speech-to-text failed". The result is trimmed, and an empty transcript gives a 422 (the LLM is **not** called).
   - **Inside `OpenAiSttProvider.transcribe`:**
     1. Look up the file extension for the MIME type (`audio/mp4` → `mp4`). An unknown type throws before any network call, which becomes a 502.
     2. `toFile(buffer, 'recording.<ext>')`.
     3. `client.audio.transcriptions.create({ file, model: STT_MODEL, response_format: 'json', language? }, { signal })` sends `POST https://api.openai.com/v1/audio/transcriptions` (multipart).
     4. The SDK retries once on 408/409/429/5xx or a network error; it never retries a 401 or 400.
     5. Return `result.text`.
8. **`callProvider` → `llm.answer`**. A throw gives a 502 "The assistant failed…" (or a 504 if the deadline passed).
   - **Inside `AnthropicLlmProvider.answer`:**
     1. Build `messages` = history + `{ role: 'user', content: transcript }`.
     2. `client.beta.messages.create({ model: LLM_MODEL, system: SYSTEM_PROMPT, max_tokens: 16000, output_config: { effort: LLM_EFFORT }, fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] }, { signal })` sends `POST https://api.anthropic.com/v1/messages`. If a safety classifier declines, Anthropic re-runs the request on its fallback model **inside this same call**.
     3. The SDK retries once on transient errors, like OpenAI's.
     4. `stop_reason === 'refusal'` returns the fixed `REFUSAL_ANSWER`, which is a normal 200 answer, not an error.
     5. Otherwise, join only the `text` blocks (`thinking` blocks are skipped). Empty text throws, which becomes a 502.
9. The handler returns `AskResponse`, which Fastify serialises as 200 JSON.
10. The **`finally`** block always logs one `ask finished` line. Its status comes from `toPublicError(error).statusCode` when the request failed.
11. On a throw, **`app.ts` error handler** calls `toPublicError(error)` to get `{ statusCode, message }`, logs the full error only for 5xx, and sends `{ error: message }`.

## 4. Call graph

```
index.ts:main
├─ config.ts:loadConfig ─ EnvSchema.safeParse (zod)
├─ services/stt/index.ts:createSttProvider → new stt/openai.ts:OpenAiSttProvider → new OpenAI({maxRetries:1, timeout})
│                                          (or stt/mock.ts:MockSttProvider)
├─ services/llm/index.ts:createLlmProvider → new llm/anthropic.ts:AnthropicLlmProvider → new Anthropic({maxRetries:1, timeout})
│                                          (or llm/mock.ts:MockLlmProvider)
├─ app.ts:buildApp
│   ├─ register(@fastify/cors, @fastify/rate-limit, @fastify/multipart)
│   ├─ setErrorHandler ─▶ errors.ts:toPublicError ─▶ errors.ts:statusOf
│   ├─ routes/health.ts:registerHealthRoute
│   └─ routes/ask.ts:registerAskRoute
└─ app.listen

[per request] routes/ask.ts handler
├─ readUpload ─▶ request.parts() / part.toBuffer()   (async iterator, multipart plugin)
│   └─ parseHistory ─▶ shared:HistorySchema.safeParse
├─ history.ts:capHistory
├─ callProvider ─▶ SttProvider.transcribe
│     OpenAiSttProvider.transcribe ─▶ toFile ─▶ client.audio.transcriptions.create ─▶ HTTPS OpenAI
├─ callProvider ─▶ LlmProvider.answer
│     AnthropicLlmProvider.answer ─▶ client.beta.messages.create ─▶ HTTPS Anthropic
│     (route tests use vi.fn fakes; provider tests use a fake fetch)
└─ (catch) errors.ts:toPublicError → status for the log line
```

The route only knows the **interfaces** (`SttProvider`, `LlmProvider`). Only the two `create*Provider` factories know the concrete classes.

## 5. Data flow

| Step              | Data in                                                                                                                                                       | Data out                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Browser to server | multipart: `audio` (binary, e.g. `audio/webm`), `history` (JSON string)                                                                                       | n/a                                                                                                                              |
| `readUpload`      | multipart stream                                                                                                                                              | `{ audio: Buffer, mimeType: 'audio/webm', history: ChatMessage[] }` (MIME params like `;codecs=opus` are stripped by the parser) |
| `capHistory`      | `ChatMessage[]`                                                                                                                                               | the last ≤N `ChatMessage[]`, starting with `user`                                                                                |
| `stt.transcribe`  | `Buffer` + `{ mimeType, language: 'en' \| 'hi' \| undefined, signal }`                                                                                        | `string` transcript                                                                                                              |
| to OpenAI         | multipart: `file=recording.<ext>`, `model`, `response_format=json`, `language` (only if set)                                                                  | JSON `{ text }`                                                                                                                  |
| to Anthropic      | JSON: `model`, `system`, `messages[]`, `max_tokens`, `output_config.effort`, `fallbacks:'default'` + header `anthropic-beta: server-side-fallback-2026-07-01` | JSON message: `content[]` (thinking + text blocks), `stop_reason`                                                                |
| `llm.answer`      | capped history + transcript + `{ signal }`                                                                                                                    | `string` answer (Markdown)                                                                                                       |
| Response 200      | n/a                                                                                                                                                           | `{ transcript, answer, timingMs: { stt, llm } }` (`AskResponse`, shared)                                                         |
| Response 4xx/5xx  | n/a                                                                                                                                                           | `{ error: string }` (`ApiErrorResponse`, shared)                                                                                 |

`ChatMessage = { role: 'user' | 'assistant', content: string }`, defined in `packages/shared/src/index.ts`.

## 6. Tests

`test/helpers.ts:makeApp(envOverrides, fakes)` calls `loadConfig({NODE_ENV:'test', …})` and then `buildApp` with `vi.fn()` STT/LLM fakes. Tests send real multipart bodies, built with the platform `FormData` (`helpers.ts:multipart`), through `app.inject()`. No port is opened and no API keys are needed.

`test/providers.test.ts` builds the real `OpenAiSttProvider` / `AnthropicLlmProvider` with a **fake `fetch`** passed into the SDK client. The fake records every HTTP request and returns canned responses. It passes through the OpenAI SDK's local `fetch('data:,')` probe, which isn't counted as a request. The tests check the request URL, body and headers, the retry count, refusal handling, and aborts.

---

# Web app (`apps/web`)

## 7. Entry point

`pnpm dev` starts Vite on `http://localhost:5173`, and Vite serves `index.html`.

1. `index.html` loads `/src/main.tsx`.
2. `main.tsx` imports `index.css` (Tailwind) and renders `<App />` into `#root` inside `StrictMode`.
3. **Vite proxy:** any browser request to `/api/*` is forwarded to `http://127.0.0.1:8787` (the Fastify server). If that server is down, the proxy itself answers **502 with an empty body**.

## 8. Execution order: one push-to-talk turn

```
press (pointerdown on MicButton  |  Space keydown on window)
  └ useVoiceAgent.press()          ignored while busy
      └ useRecorder.start()
          getUserMedia({audio})    ← 1st time: browser permission prompt
          (released already? → stop tracks, nothing recorded)
          new MediaRecorder(stream, pickMimeType(...)).start()   phase = recording ("Listening…")
release (pointerup / pointercancel  |  Space keyup)
  └ useVoiceAgent.release()
      └ useRecorder.stop()  → recorder.stop(); await onstop; stop tracks
          < 400 ms → 'too-short'  → status: "Recording too short…" (no request)
          else     → Blob(chunks, recorder.mimeType)
      busy = true  (mic disabled, "Transcribing and thinking…", typing dots in chat)
      └ api.askQuestion(blob, messages, abortSignal)
          FormData{ audio: recording.<ext>, history: JSON }  → POST /api/ask (via proxy)
          ok    → AskResponse
          !ok   → AskError(server {error} | "Can't reach the server" | "Request failed (HTTP n)")
      success → messages += [user transcript, assistant answer]; timing = timingMs
      failure → error shown in StatusBar (unless aborted by New conversation)
      busy = false
```

Step by step:

1. **Press.** `MicButton.onPointerDown` (left button only) captures the pointer and calls `press()`. Alternatively, `App`'s window `keydown` handler for Space (ignoring key-repeat) calls `press()`.
2. **`useVoiceAgent.press`** returns immediately if `busy`. Otherwise it clears the old error and calls `useRecorder.start()`.
3. **`useRecorder.start`** creates a session and sets the state to `starting` (the UI already shows `recording`). It awaits `getUserMedia`, and a failure is turned into a message by `micErrorMessage`. If the user already released, it stops the tracks and exits. Otherwise it creates a `MediaRecorder` with the first supported type (`pickMimeType`), collects chunks in `ondataavailable`, starts recording, and sets the state to `recording`.
4. **Release.** `onPointerUp`/`onPointerCancel` or Space `keyup` calls `release()`.
5. **`useRecorder.stop`**: if no recorder exists yet (still starting), it marks the press `releasedEarly` and returns `cancelled`. Otherwise it stops the recorder, waits for `onstop` (all chunks are in by then), stops the mic tracks, and returns `too-short` or `{ blob }`.
6. **`useVoiceAgent.release`** sets `busy`, creates an `AbortController`, and calls `askQuestion(blob, messages, signal)`.
7. **`api.askQuestion`** builds the multipart body (`fileNameFor` picks `recording.webm`/`.mp4`/`.ogg`), sends `POST /api/ask` (section 3 above is the server side), and parses the JSON or throws an `AskError` with a ready-to-show message.
8. On success, the transcript and answer are added to `messages`, which re-renders `ChatLog` (and auto-scrolls) and `StatusBar` (timing line). On failure, the error goes to `StatusBar`.
9. **New conversation** (`reset`) aborts any in-flight request and clears the messages, timing and error.

## 9. Call graph (web)

```
main.tsx → <App>
App
├─ useVoiceAgent()
│   ├─ useRecorder() → { state, error, start, stop }
│   │   ├─ start → navigator.mediaDevices.getUserMedia → recording.ts:pickMimeType → new MediaRecorder
│   │   │          (catch) recording.ts:micErrorMessage
│   │   └─ stop  → MediaRecorder.stop → onstop → new Blob
│   ├─ press   → useRecorder.start
│   ├─ release → useRecorder.stop → api.ts:askQuestion → fileNameFor, fetch('/api/ask')
│   └─ reset   → AbortController.abort
├─ useEffect: window keydown/keyup (Space) → press / release
├─ <ChatLog messages pending>   → react-markdown for agent bubbles; scrollIntoView on change
├─ <StatusBar phase error timing>
└─ <MicButton phase onPress onRelease>  → pointer events → press / release
```

## 10. Data flow (web)

| Step            | Data                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Recorder → hook | `Blob` (`audio/webm;codecs=opus` on Chrome/Firefox, `audio/mp4` on Safari) + `durationMs`                              |
| Hook → server   | `FormData { audio: File(recording.<ext>), history: JSON.stringify(ChatMessage[]) }`                                    |
| Server → hook   | `AskResponse { transcript, answer, timingMs }` or `{ error }`                                                          |
| Hook state      | `messages: ChatMessage[]` (in memory only, also sent as history), `timing`, `error`, `phase`                           |
| Hook → UI       | `phase` → button look + status text; `messages` → bubbles; `error` → red status line; `timing` → `STT n ms · LLM n ms` |
