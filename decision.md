# Decision log

Append-only. Newest at the bottom.

### 2026-10-19 — Backend first, real providers deferred to the next change

- **Decision:** This change builds the full backend (`POST /api/ask`, `GET /api/health`, validation, errors, logging, tests) with **mock** STT and LLM providers only. `openai`, `deepgram` and `anthropic` are accepted config values but the factories throw "not implemented yet" at boot.
- **Reason:** PRD §14 says build the backend with mocks first. Keeping real SDK code out makes this change small enough to review and quiz on, and the whole pipeline runs with no API keys.
- **Alternatives rejected:** Wiring OpenAI + Anthropic in the same change: doubles the review size and needs keys to test end to end.
- **Files affected:** `apps/server/src/services/stt/index.ts`, `apps/server/src/services/llm/index.ts`, `.env.example`

### 2026-10-19 — `.env.example` defaults to `mock` providers (PRD says `openai`/`anthropic`)

- **Decision:** `STT_PROVIDER=mock` and `LLM_PROVIDER=mock` in `.env.example` and as config defaults.
- **Reason:** Real providers don't exist yet; defaulting to them would make `pnpm dev` fail at boot. Will flip to the PRD defaults when the real providers land.
- **Alternatives rejected:** PRD defaults now: server could not start.
- **Files affected:** `.env.example`, `apps/server/src/config.ts`

### 2026-10-19 — TypeScript pinned to 6.0.x, not the newest 7.0

- **Decision:** `typescript@~6.0.3` in every package.
- **Reason:** Measured: `pnpm add typescript` installed 7.0.2, but `typescript-eslint@8.71.2` declares support only for `>=4.8.4 <6.1.0` (`pnpm peers check`). Typed lint rules (e.g. no unsafe `any`) need the compiler API that typescript-eslint drives.
- **Alternatives rejected:** TS 7 + no typed linting: loses the PRD's "no `any`" enforcement. TS 7 for `tsc` and 6 for ESLint: two compilers that can disagree.
- **Files affected:** `package.json`, `apps/server/package.json`, `packages/shared/package.json`

### 2026-10-19 — Allow esbuild's install script

- **Decision:** `allowBuilds: { esbuild: true }` in `pnpm-workspace.yaml`.
- **Reason:** pnpm 12 blocks dependency install scripts by default and failed the install. `tsx` (dev server) and `vitest` both run on esbuild, which uses its install script to set up its native binary.
- **Alternatives rejected:** Leaving it blocked: install fails. Allowing all builds: unnecessary supply-chain exposure.
- **Files affected:** `pnpm-workspace.yaml`

### 2026-10-19 — ESM + `NodeNext` modules, run TypeScript directly with `tsx`, no build step yet

- **Decision:** All packages are ESM (`"type": "module"`), TS uses `module/moduleResolution: NodeNext` (relative imports end in `.js`). The server runs via `tsx` in both `dev` and `start`. `packages/shared` exports its `.ts` source directly.
- **Reason:** No compile step to maintain while the code is small. `NodeNext` keeps the code valid for a real `tsc` build later (for deployment).
- **Alternatives rejected:** `moduleResolution: Bundler` (no `.js` suffixes): output would not run in plain Node. Building `shared` to `dist/`: extra watch process for zero benefit right now.
- **Files affected:** `tsconfig.base.json`, `apps/server/package.json`, `packages/shared/package.json`

### 2026-10-19 — Zod schemas for chat history live in `packages/shared`

- **Decision:** `ChatMessageSchema`, `HistorySchema`, `AskResponse`, `ApiErrorResponse` are defined once in `@voice-agent/shared`. The LLM `ChatMessage` type re-exports it.
- **Reason:** The web app (next change) builds the history and reads the response; one definition keeps the client and server from drifting.
- **Alternatives rejected:** Duplicate types per app: drift risk. Plain TS types without Zod: no runtime validation on the server (PRD B7).
- **Files affected:** `packages/shared/src/index.ts`, `apps/server/src/services/llm/types.ts`

### 2026-10-19 — `buildApp(deps)` takes providers as arguments (dependency injection)

- **Decision:** `app.ts:buildApp({ config, stt, llm })` builds the Fastify app. `index.ts` picks real providers from env vars; tests pass `vi.fn()` fakes.
- **Reason:** Tests need no API keys or module mocking (PRD §13), and routes only see the interfaces (PRD §8).
- **Alternatives rejected:** Routes import a provider singleton: tests would need `vi.mock` path tricks, and providers would be created at import time.
- **Files affected:** `apps/server/src/app.ts`, `apps/server/src/index.ts`, `apps/server/test/helpers.ts`

### 2026-10-19 — Errors: one `ApiError` type, provider errors never reach the client

- **Decision:** Anything the user may see is thrown as `ApiError(status, safeMessage)`. `errors.ts:toPublicError` maps everything else: known Fastify/plugin codes get friendly text (413 too large, 415 not multipart, 429 rate limit), other 4xx keep Fastify's message, and anything else is a generic 500. Provider failures are wrapped by `ask.ts:callProvider` into a fixed 502 message. The original error goes into `cause` (logged only).
- **Reason:** PRD B8 says never leak keys or stack traces. SDK errors often include request URLs or key fragments, so their text is never forwarded.
- **Alternatives rejected:** Forwarding `error.message` for 5xx: leak risk. A separate error class per case: more code, same outcome.
- **Files affected:** `apps/server/src/errors.ts`, `apps/server/src/app.ts`, `apps/server/src/routes/ask.ts`

### 2026-10-19 — Request deadline via `AbortSignal`, added as an optional field on the provider interfaces

- **Decision:** `REQUEST_TIMEOUT_MS` (default 30 s) does two things. Fastify's `requestTimeout` limits how long the upload may take. For the processing, the route creates one `AbortSignal.timeout(...)` and passes it to both `stt.transcribe` (`opts.signal`) and `llm.answer` (new optional 3rd param `opts.signal`). If a provider fails after the deadline, the route answers 504.
- **Reason:** PRD §7 wants a 30 s timeout. Fastify's `requestTimeout` only bounds receiving the upload, not the time spent calling STT/LLM. A signal lets real SDKs actually cancel the HTTP call instead of leaving it running.
- **Alternatives rejected:** `Promise.race` with a timer: the response would be sent but the provider call would keep running and cost money. A socket timeout (`connectionTimeout`): kills the connection with no JSON error.
- **Files affected:** `apps/server/src/services/stt/types.ts`, `apps/server/src/services/llm/types.ts`, `apps/server/src/routes/ask.ts`, `apps/server/src/config.ts`

### 2026-10-19 — Retry-once deferred to the real providers

- **Decision:** No generic retry wrapper yet. Each real provider will set its SDK's built-in retry (`maxRetries: 1`) when it lands.
- **Reason:** Only the provider knows which errors are transient (429/5xx/network vs. a bad key). Mocks never fail transiently, so a wrapper now would be untested code.
- **Alternatives rejected:** A generic `withRetry` in the route: would also retry a bad API key or 4xx and double the latency.
- **Files affected:** none yet

### 2026-10-19 — History cap keeps the last N, then drops leading assistant turns

- **Decision:** `history.ts:capHistory` takes the last `MAX_HISTORY_MESSAGES` messages, then removes assistant messages from the front until it starts with a user turn. `MAX_HISTORY_MESSAGES=0` sends no history.
- **Reason:** PRD B7 (cost cap). Anthropic's Messages API rejects a conversation whose first message is from the assistant, and a plain `slice(-N)` can produce exactly that. Also `slice(-0)` returns the whole array, so 0 is special-cased.
- **Alternatives rejected:** Plain `slice(-N)`: breaks with Anthropic. Capping on the client only: the server must not trust the client.
- **Files affected:** `apps/server/src/history.ts`, `apps/server/src/routes/ask.ts`

### 2026-10-19 — Upload limits and format check

- **Decision:** Multipart limits: 1 file, ≤10 MB, ≤4 fields, ≤5 parts, history field ≤256 KB. A recording under 1024 bytes gets a 400. The MIME type must start with `audio/` or `video/`. History may be missing (treated as `[]`), but if present it must be valid JSON matching `HistorySchema` (max 200 items, each ≤8000 chars). Every file part is read fully before being rejected.
- **Reason:** PRD B1/B2/B7. The `video/` prefix is allowed because some browsers label audio-only WebM/MP4 recordings as `video/*`. A file part that isn't read keeps the request hanging.
- **Alternatives rejected:** Allow-listing exact types (`audio/webm`, `audio/mp4`, …): breaks on browser quirks. Measured: the multipart parser strips `;codecs=opus`, so the server sees `audio/webm`.
- **Files affected:** `apps/server/src/app.ts`, `apps/server/src/routes/ask.ts`, `packages/shared/src/index.ts`

### 2026-10-19 — One summary log line per ask, transcript only outside production

- **Decision:** `ask.ts` logs `ask finished` from a `finally` block, with `audioBytes`, `mimeType`, `historyMessages`, `sttMs`, `llmMs`, `transcriptChars` and `status`. The transcript text is logged only when `NODE_ENV !== 'production'`. Audio bytes are never logged. Logs are pino JSON, and logging is off when `NODE_ENV=test`.
- **Reason:** PRD B10. The `finally` block means failed requests also get a line with their status.
- **Alternatives rejected:** `pino-pretty` for dev: an extra dependency, not needed yet.
- **Files affected:** `apps/server/src/routes/ask.ts`, `apps/server/src/app.ts`

### 2026-10-19 — Not done in this change

- **Decision:** No `@fastify/static` (no web build to serve yet), no `trustProxy` (the rate limit uses the socket IP, which is correct for localhost), no git init.
- **Reason:** Each needs the frontend or a deployment target first.
- **Alternatives rejected:** n/a
- **Files affected:** none

### 2026-10-19 — Real providers: OpenAI for speech-to-text, Anthropic Claude for answers

- **Decision:** Added `services/stt/openai.ts` (`OpenAiSttProvider`) and `services/llm/anthropic.ts` (`AnthropicLlmProvider`), wired into the two `create*Provider` factories. Deepgram is still not implemented (PRD: "if time allows").
- **Reason:** PRD §9 picks these two as defaults. All SDK imports stay inside these two files (PRD §14), and the route did not change.
- **Alternatives rejected:** Calling the HTTP APIs with raw `fetch`: re-implements retries, timeouts and typed errors that the SDKs already provide.
- **Files affected:** `apps/server/src/services/stt/openai.ts`, `apps/server/src/services/llm/anthropic.ts`, `apps/server/src/services/stt/index.ts`, `apps/server/src/services/llm/index.ts`

### 2026-10-19 — Retry once using each SDK's built-in retry (`maxRetries: 1`)

- **Decision:** Both SDK clients are created with `maxRetries: 1` and `timeout: REQUEST_TIMEOUT_MS`.
- **Reason:** PRD §7 asks for one retry on transient errors. The SDKs already retry only the transient cases (408/409/429/5xx and network errors) and never retry a bad key (401) or a bad request (400). The tests confirm both: one 500 then success makes 2 requests, and a 401 makes 1.
- **Alternatives rejected:** A hand-written retry wrapper: would have to re-classify errors, and the SDK default of 2 retries would also stack on top of it.
- **Files affected:** `apps/server/src/services/stt/openai.ts`, `apps/server/src/services/llm/anthropic.ts`

### 2026-10-19 — Claude call: `claude-sonnet-5-5`, effort `low`, server-side fallback on, text blocks only

- **Decision:** `client.beta.messages.create` with `model: LLM_MODEL` (default `claude-sonnet-5-5`, as the PRD names it), `system: SYSTEM_PROMPT`, `output_config.effort: LLM_EFFORT` (new env var, default `low`), `max_tokens: 16000`, and `fallbacks: 'default'` with beta `server-side-fallback-2026-07-01`. The answer is the joined `text` blocks; `thinking` blocks are ignored. `stop_reason: 'refusal'` returns a fixed polite answer, and an empty answer throws (which becomes a 502).
- **Reason:** On this model thinking cannot be turned off, so effort is the only speed control. `low` is the recommended level for chat and fits PRD §7 (LLM < 2 s). The fallback re-runs a request that a safety classifier declined on Anthropic's recommended model, within the same call. A refusal is a valid outcome, not a server error. `max_tokens` leaves room for thinking tokens, which count toward it.
- **Alternatives rejected:** `thinking: {type: 'disabled'}`: returns a 400 on Sonnet 5.5. Default effort `high`: slower than needed for short spoken questions. A small `max_tokens` like 1024: thinking could use it up and leave no answer.
- **Files affected:** `apps/server/src/services/llm/anthropic.ts`, `apps/server/src/config.ts`, `.env.example`

### 2026-10-19 — OpenAI upload: filename extension picked from the MIME type

- **Decision:** A fixed table maps MIME type to extension (`audio/webm`→`webm`, `audio/mp4`→`mp4`, `audio/ogg`→`ogg`, …), and the file is sent as `recording.<ext>` via the SDK's `toFile`. An unknown type throws before any API call (it becomes a 502). `language` is sent only when `STT_LANGUAGE` is set; otherwise OpenAI auto-detects.
- **Reason:** OpenAI detects the audio format from the filename. Safari records MP4 and Chrome records WebM, so one fixed name would break one of them.
- **Alternatives rejected:** Always `recording.webm`: breaks Safari. Converting the audio with ffmpeg: a heavy dependency for no gain.
- **Files affected:** `apps/server/src/services/stt/openai.ts`

### 2026-10-19 — No automatic `whisper-1` fallback; switching STT model is a config change

- **Decision:** `STT_MODEL` defaults to `gpt-4o-mini-transcribe`. The PRD's "fallback `whisper-1`" means: set `STT_MODEL=whisper-1` if needed. There is no automatic switch at runtime.
- **Reason:** An automatic switch would hide a misconfigured model and double latency on failures. Measured: OpenAI's SDK now also lists a newer `gpt-transcribe` model. It is not adopted without testing Hindi/Hinglish accuracy.
- **Alternatives rejected:** Catch "model not found" and retry on `whisper-1`: extra code path for a config mistake.
- **Files affected:** none (config only)

### 2026-10-19 — `.env.example` now uses real providers; code defaults stay `mock`

- **Decision:** `.env.example` sets `STT_PROVIDER=openai`, `LLM_PROVIDER=anthropic` (the PRD defaults). When an env var is unset, `config.ts` still defaults to `mock`.
- **Reason:** Copying `.env.example` gives the real app and fails at startup if a key is missing (fail fast, PRD §9). With no `.env` at all, the server and the tests still run with no keys.
- **Alternatives rejected:** Code defaults of `openai`/`anthropic`: the tests and a first run without keys would crash.
- **Files affected:** `.env.example`

### 2026-10-19 — Provider tests use a fake `fetch` passed to the SDK

- **Decision:** Both providers accept an optional `fetch` (passed to the SDK client). `test/providers.test.ts` gives them a fake network that records each request and returns canned responses. The tests check the real request shape: URL, multipart fields, JSON body and the beta header.
- **Reason:** These tests catch request-shape bugs with no keys and no internet, and also check the retry count. Measured: the OpenAI SDK first calls `fetch('data:,')`, a local check of the fetch function; the fake passes it through and doesn't count it.
- **Alternatives rejected:** `vi.mock('openai')`: tests our assumptions about the SDK, not the HTTP it actually sends.
- **Files affected:** `apps/server/src/services/stt/openai.ts`, `apps/server/src/services/llm/anthropic.ts`, `apps/server/test/providers.test.ts`

### 2026-10-19 — Web app: Vite proxies `/api` to the server in dev

- **Decision:** `apps/web/vite.config.ts` forwards `/api/*` to `http://127.0.0.1:8787`, and the browser always calls the relative URL `/api/ask`. Vite runs on port 5173 with `strictPort`.
- **Reason:** The browser sees one origin, so there's no CORS preflight in dev, and the same code works in production when the server also serves the web build. `strictPort` makes a port clash fail loudly instead of silently moving to a different port that `CORS_ORIGIN` doesn't expect.
- **Alternatives rejected:** Calling `http://localhost:8787` directly: cross-origin, so it depends on CORS and a hard-coded URL.
- **Files affected:** `apps/web/vite.config.ts`, `apps/web/src/api.ts`

### 2026-10-19 — Mic opened per press and released after; minimum press of 400 ms

- **Decision:** `useRecorder.start()` calls `getUserMedia` on every press, and `stop()` stops all tracks. Presses under 400 ms are never sent (the status says "Recording too short"). Releasing before the mic finished starting (for example, while the first-time permission prompt is open) cancels the press quietly.
- **Reason:** The browser's "microphone in use" indicator is on only while the button is held (privacy). After the first permission grant, opening the mic is fast. The 400 ms floor catches accidental taps without paying for a server round-trip.
- **Alternatives rejected:** Keeping the mic open all session: slightly faster start, but the mic indicator stays on the whole time. Relying only on the server's 1 KB check: wastes a request for every accidental tap.
- **Files affected:** `apps/web/src/hooks/useRecorder.ts`, `apps/web/src/recording.ts`

### 2026-10-19 — Recording format: first supported of WebM/Opus → WebM → MP4 → Ogg

- **Decision:** `pickMimeType` asks `MediaRecorder.isTypeSupported` in that order. If none is supported, the browser picks its default. The Blob's real `recorder.mimeType` is what gets uploaded.
- **Reason:** Chrome and Firefox record WebM/Opus (small and well supported by OpenAI). Safari records only MP4. The server maps the type to a file extension for OpenAI.
- **Alternatives rejected:** Hard-coding `audio/webm`: `new MediaRecorder` throws on Safari.
- **Files affected:** `apps/web/src/recording.ts`, `apps/web/src/hooks/useRecorder.ts`

### 2026-10-19 — One hook owns the turn; components only display

- **Decision:** `hooks/useVoiceAgent.ts` holds the phase (`idle`, `recording` or `busy`), the history, the last error and the timing, and exposes `press`, `release` and `reset`. `MicButton`, `ChatLog` and `StatusBar` only render props. The history is the `messages` array kept in memory, and only successful turns are added to it.
- **Reason:** A single place to read the flow, matching what follow.md describes. Phase 2 (voice output, streaming) changes this hook, not the components. A failed turn never adds a half-finished pair to the history.
- **Alternatives rejected:** A state library (Redux/Zustand): overkill for one screen. Logic inside `App.tsx`: mixes layout and flow.
- **Files affected:** `apps/web/src/hooks/useVoiceAgent.ts`, `apps/web/src/App.tsx`, `apps/web/src/components/*`

### 2026-10-19 — Push-to-talk input: pointer events with capture; Space bar on `window`

- **Decision:** `MicButton` uses `pointerdown` (with `setPointerCapture`), `pointerup` and `pointercancel`, plus `touch-none`, `select-none` and no context menu. The Space bar is handled by `window` keydown/keyup listeners in `App.tsx`, ignoring key-repeat and with `preventDefault`.
- **Reason:** Pointer events cover mouse, touch and pen with one code path. Capture means sliding a finger off the button still counts as a release. `preventDefault` stops Space from scrolling the page or "clicking" a focused button (for example, New conversation).
- **Alternatives rejected:** Separate mouse and touch handlers: duplicated logic, and `touchend` is missed when the finger leaves the button.
- **Files affected:** `apps/web/src/components/MicButton.tsx`, `apps/web/src/App.tsx`

### 2026-10-19 — Client error messages: server text first, then gateway and network fallbacks

- **Decision:** `api.ts:askQuestion` shows the server's `{ error }` text when there is one. A non-JSON 502/503/504, or a network failure, shows "Can't reach the server. Is it running?". Any other status shows "Request failed (HTTP n)". A cancelled request (New conversation pressed mid-request) is ignored.
- **Reason:** Measured: with the API server stopped, Vite's proxy replies **502 with an empty body**, so the user would otherwise see a vague "HTTP 502". The server already writes friendly messages (PRD user story 5).
- **Alternatives rejected:** Showing the raw status for everything: not actionable for the user.
- **Files affected:** `apps/web/src/api.ts`, `apps/web/src/api.test.ts`

### 2026-10-19 — Web types from `@voice-agent/shared`, imported as types only

- **Decision:** The web app uses `import type` for `ChatMessage`, `AskResponse` and `ApiErrorResponse`.
- **Reason:** The shared package also contains Zod schemas. Type-only imports keep Zod out of the browser bundle (measured: 0 occurrences of `zod` in `dist/assets/*.js`).
- **Alternatives rejected:** Validating responses with Zod in the browser: adds about 50 KB to protect against our own server.
- **Files affected:** `apps/web/src/api.ts`, `apps/web/src/hooks/useVoiceAgent.ts`, `apps/web/src/components/*`

### 2026-10-19 — Web tests cover pure logic only (no jsdom / component tests yet)

- **Decision:** Vitest runs in Node against `api.ts` (with a stubbed global `fetch`) and `recording.ts`. The recorder and UI were verified in a real browser, with a generated audio tone standing in for the microphone.
- **Reason:** `MediaRecorder` and `getUserMedia` don't exist in jsdom, so component tests would mostly be testing mocks. A real browser exercises the real recorder.
- **Alternatives rejected:** jsdom + Testing Library with mocked `MediaRecorder`: high setup cost, low confidence.
- **Files affected:** `apps/web/src/api.test.ts`, `apps/web/src/recording.test.ts`

### 2026-10-19 — Not done in this change

- **Decision:** The server does not serve the web build yet (`@fastify/static`). There's no answer streaming (Phase 1.5) and no component tests.
- **Reason:** Each is separate work. Serving the build is needed for the "single Node service" deployment (PRD §7) and is the natural next change.
- **Alternatives rejected:** n/a
- **Files affected:** none

### 2026-10-30 — Code-change rules moved to the global CLAUDE.md
- **Decision:** The full text of the 3 rules (`decision.md`, `follow.md`, quiz) now lives only in `~/.claude/CLAUDE.md`. The project CLAUDE.md just switches them on (`Code-change rules: on`) and keeps the PRD section. The global rules apply only in projects that switch them on, skip trivial edits, and skip the quiz in background runs.
- **Reason:** Two copies of the same rules would contradict each other the first time only one was edited. The global rules were also firing in every repo, including shared work repos.
- **Alternatives rejected:** Keeping the rules only in the project file means copying them by hand into every new project, and the copies drift apart. Keeping both copies works today but breaks the first time only one is edited. The downside of the choice: anyone who clones this repo won't get the rules, because they live on this Mac only. If the repo is ever shared, copy the rules into the project file.
- **Files affected:** `~/.claude/CLAUDE.md`, `CLAUDE.md`
