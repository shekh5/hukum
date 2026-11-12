# PRD: Voice Agent – Phase 1 (Voice In → Text Out)

**Owner:** Bhawani Singh
**Date:** 19 Oct 2026
**Status:** Ready to build

---

## 1. Summary

Build a simple web app where the user **speaks** a question and receives a **text answer** from an LLM. The user holds a button to talk, the audio is transcribed on a TypeScript backend, sent to an LLM, and the transcript and answer are shown in a chat-style UI.

This is Phase 1 of a two-phase project. Phase 2 will turn it into a full **voice-to-voice** conversation (see section 12). Phase 1 code must be structured so Phase 2 can reuse it without a rewrite.

---

## 2. Goals

- User can ask questions by voice and get accurate text answers.
- Supports English, Hindi and Hinglish (mixed) speech.
- Multi-turn: the agent remembers earlier turns in the same session.
- Total response time (release button → answer visible) under **3 seconds** for short questions.
- Clean, modular TypeScript code where the speech-to-text (STT) and LLM providers can be swapped by changing one file each.

## 3. Non-goals (Phase 1)

- No voice output / text-to-speech.
- No user accounts, login or database.
- No tool calling or task execution (planned as Phase 1.5).
- No phone / telephony integration.
- No mobile native app (mobile browser should still work).

---

## 4. Target user

A single user (the developer) testing and demoing a voice-driven LLM assistant in a desktop or mobile browser.

## 5. User stories

1. As a user, I hold the mic button (or spacebar), speak, and release, so that my question is sent.
2. As a user, I see what the system heard (transcript) so I know if it misunderstood me.
3. As a user, I see the LLM's answer as text right below my transcript.
4. As a user, I can ask follow-up questions and the agent understands the context.
5. As a user, I see a clear message if the mic is blocked, the recording is too short, or something fails.
6. As a user, I can clear the conversation and start fresh.

---

## 6. Functional requirements

### 6.1 Frontend

| ID  | Requirement                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Push-to-talk mic button. Press = start recording, release = stop and send. Spacebar does the same on desktop.                                           |
| F2  | Visual recording state (button grows/pulses, status text "Listening…").                                                                                 |
| F3  | Request microphone permission on first use; show a clear error if denied.                                                                               |
| F4  | Record with the browser `MediaRecorder` API; send the audio blob (webm/ogg/mp4, whatever the browser supports) to the backend as `multipart/form-data`. |
| F5  | Show a "Transcribing and thinking…" state and disable the mic while a request is in flight.                                                             |
| F6  | Chat log showing "You" (transcript) and "Agent" (answer) bubbles. Answer supports basic Markdown rendering.                                             |
| F7  | Keep conversation history in memory (client side) and send it with each request.                                                                        |
| F8  | "New conversation" button to clear history.                                                                                                             |
| F9  | Show per-turn timing (STT ms, LLM ms) in small text under the status, for debugging latency.                                                            |
| F10 | Responsive layout; works on mobile Chrome and Safari. Light and dark mode.                                                                              |

### 6.2 Backend

| ID  | Requirement                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `POST /api/ask` accepts `audio` (file) and `history` (JSON string) as multipart form data.                                                                           |
| B2  | Reject audio smaller than ~1 KB (too short) with HTTP 400 and a friendly message. Reject files larger than 10 MB.                                                    |
| B3  | Transcribe audio via the STT service. Language is configurable (`en`, `hi`, or auto-detect).                                                                         |
| B4  | If the transcript is empty, return HTTP 422 "Couldn't hear anything".                                                                                                |
| B5  | Send history + new transcript to the LLM with a configurable system prompt. The prompt tells the model the input is speech-transcribed and may contain small errors. |
| B6  | Return JSON `{ transcript, answer, timingMs: { stt, llm } }`.                                                                                                        |
| B7  | Validate all input with Zod. History is capped (e.g. last 20 messages) to control cost.                                                                              |
| B8  | STT failures return HTTP 502 with a clear "Speech-to-text failed" message; LLM failures likewise. Never leak API keys or stack traces.                               |
| B9  | `GET /api/health` returns `{ ok: true }`.                                                                                                                            |
| B10 | Structured logging of each request: audio size, STT ms, LLM ms, status. Do not log audio content or full transcripts in production mode.                             |

### 6.3 API contract

**Request**

```
POST /api/ask
Content-Type: multipart/form-data

audio:   <binary audio file>
history: '[{"role":"user","content":"..."},{"role":"assistant","content":"..."}]'
```

**Success response – 200**

```json
{
  "transcript": "What is the capital of Rajasthan?",
  "answer": "The capital of Rajasthan is Jaipur.",
  "timingMs": { "stt": 640, "llm": 1210 }
}
```

**Error response – 4xx/5xx**

```json
{ "error": "Recording too short - hold the button while speaking." }
```

---

## 7. Non-functional requirements

| Area         | Requirement                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Latency      | STT < 1.2 s and LLM < 2 s for a ~5 second question (p50).                                                                           |
| Security     | API keys only on the server, loaded from `.env`. Basic rate limit (e.g. 30 req/min per IP). CORS restricted to the frontend origin. |
| Privacy      | Audio is processed in memory and never written to disk.                                                                             |
| Reliability  | One automatic retry on transient STT/LLM network errors. Request timeout of 30 s.                                                   |
| Code quality | TypeScript `strict` mode, ESLint + Prettier, no `any`.                                                                              |
| Portability  | Runs locally with one command; deployable as a single Node service.                                                                 |

---

## 8. Architecture

```
┌──────────────────────┐   multipart (audio + history)   ┌──────────────────────────┐
│  Web app (React/TS)  │ ──────────────────────────────▶ │  API server (Node/TS)    │
│  - MediaRecorder     │                                 │  /api/ask                │
│  - Chat UI           │ ◀────────────────────────────── │   1. validate (Zod)      │
└──────────────────────┘   JSON {transcript, answer}     │   2. stt.transcribe()    │──▶ STT provider
                                                         │   3. llm.answer()        │──▶ LLM provider
                                                         └──────────────────────────┘
```

**Provider abstraction (important for swapping and for Phase 2):**

```ts
// services/stt/types.ts
export interface SttProvider {
  transcribe(audio: Buffer, opts: { mimeType: string; language?: string }): Promise<string>;
}

// services/llm/types.ts
export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export interface LlmProvider {
  answer(history: ChatMessage[], userText: string): Promise<string>;
}
```

The route handler only talks to these interfaces. The concrete provider is chosen from env vars (`STT_PROVIDER`, `LLM_PROVIDER`).

---

## 9. Tech stack

| Layer             | Choice                                                                                         | Why                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Language          | **TypeScript** (strict) everywhere                                                             | One language for frontend and backend; shared types.                          |
| Runtime           | **Node.js 24 LTS**                                                                             | Current LTS; native `fetch`, `FormData`, `Blob`.                              |
| Package manager   | **pnpm** with workspaces                                                                       | Monorepo with shared types package.                                           |
| Backend framework | **Fastify** + `@fastify/multipart`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/static`  | Fast, typed, good multipart support.                                          |
| Validation        | **Zod**                                                                                        | Runtime validation + inferred TS types.                                       |
| Config            | **dotenv** + Zod-validated env schema                                                          | Fail fast on missing keys.                                                    |
| Logging           | **pino** (built into Fastify)                                                                  | Structured JSON logs.                                                         |
| STT (default)     | **OpenAI transcription API** (`gpt-4o-mini-transcribe`, fallback `whisper-1`) via `openai` SDK | Good accuracy, supports Hindi, simple API.                                    |
| STT (alternative) | **Deepgram Nova-3** via `@deepgram/sdk`                                                        | Better for streaming in Phase 2. Implement as second provider if time allows. |
| LLM               | **Anthropic Claude** (`claude-sonnet-5-5`) via `@anthropic-ai/sdk`                             | Strong reasoning and tool use for Phase 1.5.                                  |
| Frontend          | **React + Vite + TypeScript**                                                                  | Fast dev server; easy to extend for Phase 2.                                  |
| Styling           | **Tailwind CSS**                                                                               | Quick, consistent styling; dark mode support.                                 |
| Markdown          | `react-markdown`                                                                               | Render LLM answers.                                                           |
| Testing           | **Vitest** (unit), **Supertest / Fastify inject** (API)                                        | Mock providers so tests need no API keys.                                     |
| Lint / format     | ESLint + Prettier                                                                              | Consistent code.                                                              |
| Dev               | `tsx watch` for backend, Vite dev server with proxy to backend                                 | One `pnpm dev` runs both.                                                     |

---

## 10. Project structure

```
voice-agent/
├── package.json              # pnpm workspace root; "dev" runs both apps
├── pnpm-workspace.yaml
├── .env.example
├── README.md
├── packages/
│   └── shared/               # shared TS types (ChatMessage, AskResponse, errors)
│       └── src/index.ts
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts              # Fastify bootstrap
│   │   │   ├── config.ts             # Zod-validated env
│   │   │   ├── routes/ask.ts         # POST /api/ask
│   │   │   ├── routes/health.ts
│   │   │   ├── services/stt/
│   │   │   │   ├── types.ts
│   │   │   │   ├── openai.ts
│   │   │   │   └── deepgram.ts       # optional
│   │   │   └── services/llm/
│   │   │       ├── types.ts
│   │   │       └── anthropic.ts
│   │   ├── test/ask.test.ts
│   │   └── tsconfig.json
│   └── web/
│       ├── src/
│       │   ├── App.tsx
│       │   ├── hooks/useRecorder.ts  # MediaRecorder logic
│       │   ├── api.ts                # calls /api/ask
│       │   └── components/ (MicButton, ChatLog, StatusBar)
│       ├── index.html
│       └── vite.config.ts            # proxy /api → server
```

---

## 11. Configuration (`.env`)

```bash
# Providers
STT_PROVIDER=openai            # openai | deepgram
LLM_PROVIDER=anthropic

# Keys
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
DEEPGRAM_API_KEY=              # only if STT_PROVIDER=deepgram

# Models
STT_MODEL=gpt-4o-mini-transcribe
LLM_MODEL=claude-sonnet-5-5

# Behavior
STT_LANGUAGE=                  # en | hi | empty for auto-detect
SYSTEM_PROMPT="You are a helpful assistant. The user is speaking; their words were transcribed by speech-to-text, so ignore small transcription errors and filler words. Answer clearly and concisely."
MAX_HISTORY_MESSAGES=20

# Server
PORT=8787
CORS_ORIGIN=http://localhost:5173
```

---

## 12. Roadmap

**Phase 1.5 – Tasks, not just answers**

- Add LLM tool calling (e.g. set a reminder, look up data, send a message).
- Show tool actions in the chat ("✅ Reminder created for 5 PM").
- Stream the LLM answer to the browser (SSE) so text appears token by token.

**Phase 2 – Voice-to-voice**

- Add a `TtsProvider` interface (e.g. Cartesia, ElevenLabs, OpenAI TTS) and speak the answer.
- Move from push-to-talk to always-on listening with voice activity detection, turn detection and barge-in (user can interrupt).
- Switch transport from HTTP uploads to WebSocket/WebRTC streaming; evaluate LiveKit Agents (has a Node/TS SDK) or a native speech-to-speech API (OpenAI Realtime, Gemini Live).
- Target end-to-end voice latency under ~1 second.

---

## 13. Acceptance criteria (Phase 1 done when…)

- [ ] `pnpm install && pnpm dev` starts frontend and backend; app opens at `http://localhost:5173`.
- [ ] Holding the mic button / spacebar records; releasing sends and shows transcript + answer.
- [ ] A follow-up question that depends on the previous answer is answered correctly (history works).
- [ ] A Hindi or Hinglish question is transcribed and answered.
- [ ] Mic-denied, too-short recording, empty transcript, and provider errors each show a clear message.
- [ ] Changing `STT_PROVIDER` / `LLM_PROVIDER` requires no code changes outside the provider files.
- [ ] Unit/API tests pass with mocked providers (`pnpm test`), no API keys needed.
- [ ] `tsc --noEmit` and ESLint pass with zero errors.
- [ ] README explains setup, env vars, and how to add a new provider.

---

## 14. Notes for the builder

- Build the backend first with a mocked STT/LLM, then wire real providers.
- Verify the current model names and SDK method signatures against the official docs before coding (OpenAI, Anthropic, Deepgram); model names change often.
- Keep provider-specific code inside `services/`; no SDK imports in routes or UI.
- Microphone access only works on `localhost` or HTTPS.
