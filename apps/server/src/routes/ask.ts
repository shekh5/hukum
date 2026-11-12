import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HistorySchema, type AskResponse, type ChatMessage } from '@voice-agent/shared';
import type { Config } from '../config.js';
import { ApiError, toPublicError } from '../errors.js';
import { capHistory } from '../history.js';
import type { LlmProvider } from '../services/llm/index.js';
import type { SttProvider } from '../services/stt/index.js';

export const MIN_AUDIO_BYTES = 1024;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export type AskDeps = { config: Config; stt: SttProvider; llm: LlmProvider };

type AskUpload = { audio: Buffer; mimeType: string; history: ChatMessage[] };

/** POST /api/ask — audio + history in, transcript + answer out. See docs/PRD.md §6.2. */
export function registerAskRoute(app: FastifyInstance, deps: AskDeps): void {
  const { config, stt, llm } = deps;

  app.post('/api/ask', async (request): Promise<AskResponse> => {
    const log: Record<string, unknown> = {};
    let status = 200;
    try {
      const upload = await readUpload(request);
      log.audioBytes = upload.audio.length;
      log.mimeType = upload.mimeType;

      if (upload.audio.length < MIN_AUDIO_BYTES) {
        throw new ApiError(400, 'Recording too short - hold the button while speaking.');
      }

      const history = capHistory(upload.history, config.MAX_HISTORY_MESSAGES);
      log.historyMessages = history.length;
      const signal = AbortSignal.timeout(config.REQUEST_TIMEOUT_MS);

      const sttStart = performance.now();
      const transcript = await callProvider(
        'Speech-to-text failed. Please try again.',
        signal,
        () =>
          stt.transcribe(upload.audio, {
            mimeType: upload.mimeType,
            language: config.STT_LANGUAGE,
            signal,
          }),
      ).then((text) => text.trim());
      const sttMs = Math.round(performance.now() - sttStart);
      log.sttMs = sttMs;
      log.transcriptChars = transcript.length;
      if (config.NODE_ENV !== 'production') log.transcript = transcript;

      if (transcript === '') {
        throw new ApiError(422, "Couldn't hear anything - please try again.");
      }

      const llmStart = performance.now();
      const answer = await callProvider(
        'The assistant failed to answer. Please try again.',
        signal,
        () => llm.answer(history, transcript, { signal }),
      );
      const llmMs = Math.round(performance.now() - llmStart);
      log.llmMs = llmMs;

      return { transcript, answer, timingMs: { stt: sttMs, llm: llmMs } };
    } catch (error) {
      status = toPublicError(error).statusCode;
      throw error;
    } finally {
      request.log.info({ ...log, status }, 'ask finished');
    }
  });
}

/**
 * Read the multipart body: exactly one `audio` file and an optional `history` JSON field.
 * Audio stays in memory (Buffer) and is never written to disk.
 */
async function readUpload(request: FastifyRequest): Promise<AskUpload> {
  let audio: Buffer | undefined;
  let mimeType = '';
  let historyRaw: string | undefined;

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      // Always drain the stream, even for parts we reject, or the request hangs.
      const buffer = await part.toBuffer();
      if (part.fieldname !== 'audio')
        throw new ApiError(400, `Unexpected file field "${part.fieldname}".`);
      audio = buffer;
      mimeType = part.mimetype;
    } else if (part.fieldname === 'history') {
      if (part.valueTruncated || typeof part.value !== 'string') {
        throw new ApiError(400, 'Conversation history is too large or malformed.');
      }
      historyRaw = part.value;
    }
  }

  if (!audio)
    throw new ApiError(400, 'No audio received - send the recording in the "audio" field.');
  if (!/^(audio|video)\//.test(mimeType)) {
    throw new ApiError(400, `Unsupported audio format "${mimeType}".`);
  }

  return { audio, mimeType, history: parseHistory(historyRaw) };
}

function parseHistory(raw: string | undefined): ChatMessage[] {
  if (raw === undefined || raw.trim() === '') return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'Conversation history is not valid JSON.');
  }
  const result = HistorySchema.safeParse(json);
  if (!result.success) throw new ApiError(400, 'Conversation history has an invalid shape.');
  return result.data;
}

/**
 * Run one provider call. Any provider failure becomes a 502 with a fixed, user-safe message
 * (the raw error may contain URLs or key fragments, so it is only logged, never returned);
 * a deadline hit becomes a 504.
 */
async function callProvider<T>(
  failMessage: string,
  signal: AbortSignal,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    if (signal.aborted) throw new ApiError(504, 'Request timed out - please try again.');
    throw new ApiError(502, failMessage, { cause });
  }
}
