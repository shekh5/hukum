# Voice Agent

Speak a question and get a text answer from an LLM. This is Phase 1 of the project. The full spec is in [docs/PRD.md](docs/PRD.md).

**Status:** Phase 1 runs end to end: the React web app (push-to-talk, chat log, status bar) and the backend, with real providers (OpenAI for speech-to-text, Anthropic Claude for answers). Mock versions of both are included for running without API keys.

## Setup

Requires Node 24+ and pnpm.

```bash
pnpm install
cp .env.example .env     # add OPENAI_API_KEY + ANTHROPIC_API_KEY (or set both providers to mock)
pnpm dev                 # web app on http://localhost:5173, API on http://127.0.0.1:8787
```

Open http://localhost:5173, then hold the mic button (or Space), speak, and release. The microphone only works on `localhost` or HTTPS.

Port 5173 must be free: Vite is set to stop with an error rather than switch ports.

Or test the API directly:

```bash
curl http://127.0.0.1:8787/api/health
curl -F "audio=@some-recording.webm;type=audio/webm" -F 'history=[]' http://127.0.0.1:8787/api/ask
```

## Scripts (repo root)

| Command          | What it does                                               |
| ---------------- | ---------------------------------------------------------- |
| `pnpm dev`       | Runs the web app (:5173) and the API (:8787) in watch mode |
| `pnpm test`      | Runs the server and web tests (no API keys needed)         |
| `pnpm typecheck` | Runs `tsc --noEmit` in every package                       |
| `pnpm lint`      | Runs ESLint with type-aware rules (no `any`)               |
| `pnpm format`    | Formats the code with Prettier                             |

## Environment variables

See [.env.example](.env.example). The server validates them at startup and refuses to start if any are wrong, listing every problem.

| Var                                                         | Default                                        | Notes                                                                |
| ----------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `STT_PROVIDER`                                              | `mock` (`.env.example`: `openai`)              | `openai` \| `mock` (`deepgram` is not implemented yet)               |
| `LLM_PROVIDER`                                              | `mock` (`.env.example`: `anthropic`)           | `anthropic` \| `mock`                                                |
| `LLM_EFFORT`                                                | `low`                                          | How much Claude thinks: `low` is fastest, `max` is the most thorough |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPGRAM_API_KEY` | none                                           | Required only for the provider you picked                            |
| `STT_MODEL` / `LLM_MODEL`                                   | `gpt-4o-mini-transcribe` / `claude-sonnet-5-5` |                                                                      |
| `STT_LANGUAGE`                                              | empty (auto-detect)                            | `en` \| `hi`                                                         |
| `SYSTEM_PROMPT`                                             | see file                                       |                                                                      |
| `MAX_HISTORY_MESSAGES`                                      | `20`                                           |                                                                      |
| `HOST` / `PORT`                                             | `127.0.0.1` / `8787`                           | Use `0.0.0.0` when deploying                                         |
| `CORS_ORIGIN`                                               | `http://localhost:5173`                        |                                                                      |
| `RATE_LIMIT_PER_MIN`                                        | `30`                                           | Per IP                                                               |
| `REQUEST_TIMEOUT_MS`                                        | `30000`                                        | Upload time, plus the deadline for the STT + LLM calls               |
| `NODE_ENV`                                                  | `development`                                  | `production` keeps transcripts out of the logs                       |

## Adding a provider

1. Create `apps/server/src/services/stt/<name>.ts` (or `services/llm/<name>.ts`) with a class that implements `SttProvider` (or `LlmProvider`) from `types.ts`. Keep all SDK imports inside that file. Pass `opts.signal` to the SDK so request timeouts cancel the call.
2. Add `<name>` to the `STT_PROVIDER` / `LLM_PROVIDER` enum in `apps/server/src/config.ts`, plus its key check in `superRefine`.
3. Add a `case '<name>'` to `createSttProvider` / `createLlmProvider` in that folder's `index.ts`.
4. Set `STT_PROVIDER=<name>` in `.env`. The routes and the UI stay unchanged.

## Project docs

- [docs/PRD.md](docs/PRD.md): requirements
- [follow.md](follow.md): how execution flows through the code
- [decision.md](decision.md): why things are built the way they are
