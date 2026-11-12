import { afterEach, describe, expect, it, vi } from 'vitest';
import { AskError, askQuestion, fileNameFor } from './api';

const audio = new Blob([new Uint8Array(2048)], { type: 'audio/webm;codecs=opus' });

function stubFetch(impl: typeof fetch) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

afterEach(() => vi.unstubAllGlobals());

describe('fileNameFor', () => {
  it.each([
    ['audio/webm;codecs=opus', 'recording.webm'],
    ['audio/mp4', 'recording.mp4'],
    ['audio/ogg;codecs=opus', 'recording.ogg'],
    ['', 'recording.webm'],
  ])('%s -> %s', (mimeType, name) => {
    expect(fileNameFor(mimeType)).toBe(name);
  });
});

describe('askQuestion', () => {
  it('posts audio + JSON history as multipart and returns the answer', async () => {
    const fetchSpy = stubFetch(() =>
      json(200, { transcript: 'hi', answer: 'hello', timingMs: { stt: 1, llm: 2 } }),
    );
    const history = [{ role: 'user' as const, content: 'q' }];

    const result = await askQuestion(audio, history);

    expect(result.answer).toBe('hello');
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/ask');
    const form = init?.body as FormData;
    expect((form.get('audio') as File).name).toBe('recording.webm');
    expect(form.get('history')).toBe(JSON.stringify(history));
  });

  it("shows the server's error message", async () => {
    stubFetch(() => json(400, { error: 'Recording too short - hold the button while speaking.' }));
    await expect(askQuestion(audio, [])).rejects.toThrow(
      new AskError('Recording too short - hold the button while speaking.'),
    );
  });

  it('falls back to the HTTP status when the error body is not JSON', async () => {
    stubFetch(() => Promise.resolve(new Response('<html>oops</html>', { status: 500 })));
    await expect(askQuestion(audio, [])).rejects.toThrow('Request failed (HTTP 500).');
  });

  it('treats an empty 502 from a proxy as "server unreachable"', async () => {
    stubFetch(() => Promise.resolve(new Response('', { status: 502 })));
    await expect(askQuestion(audio, [])).rejects.toThrow(/can't reach the server/i);
  });

  it('explains a network failure', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(askQuestion(audio, [])).rejects.toThrow(/can't reach the server/i);
  });

  it('rethrows an abort as-is (not a user-facing error)', async () => {
    const controller = new AbortController();
    controller.abort();
    stubFetch((_url, init) => Promise.reject(init?.signal?.reason as Error));
    await expect(askQuestion(audio, [], controller.signal)).rejects.not.toBeInstanceOf(AskError);
  });
});
