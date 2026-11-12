import type { ApiErrorResponse, AskResponse, ChatMessage } from '@voice-agent/shared';

/** An error whose message is ready to show in the status bar. */
export class AskError extends Error {
  override name = 'AskError';
}

const UNREACHABLE = "Can't reach the server. Is it running?";

const EXTENSIONS: Record<string, string> = { webm: 'webm', ogg: 'ogg', mp4: 'mp4', mpeg: 'mp3' };

/** "audio/webm;codecs=opus" -> "recording.webm". The server cares about the MIME type, not the name. */
export function fileNameFor(mimeType: string): string {
  const subtype = mimeType.split(';')[0]?.split('/')[1] ?? '';
  return `recording.${EXTENSIONS[subtype] ?? 'webm'}`;
}

/** POST /api/ask with the recording and the conversation so far. See docs/PRD.md §6.3. */
export async function askQuestion(
  audio: Blob,
  history: ChatMessage[],
  signal?: AbortSignal,
): Promise<AskResponse> {
  const form = new FormData();
  form.append('audio', audio, fileNameFor(audio.type));
  form.append('history', JSON.stringify(history));

  let response: Response;
  try {
    response = await fetch('/api/ask', { method: 'POST', body: form, signal: signal ?? null });
  } catch (error) {
    if (signal?.aborted) throw error; // caller cancelled on purpose; not a user-facing error
    throw new AskError(UNREACHABLE);
  }

  const body = (await response.json().catch(() => null)) as AskResponse | ApiErrorResponse | null;
  if (!response.ok) {
    if (body && 'error' in body) throw new AskError(body.error);
    // No JSON error body: a proxy/gateway answered, not our server (e.g. Vite's dev proxy
    // replies 502 with an empty body when the API server is down).
    if (response.status >= 502 && response.status <= 504) throw new AskError(UNREACHABLE);
    throw new AskError(`Request failed (HTTP ${response.status}).`);
  }
  if (!body || !('answer' in body)) throw new AskError('The server sent an unexpected response.');
  return body;
}
