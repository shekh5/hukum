import { describe, expect, it } from 'vitest';
import type { ApiErrorResponse, AskResponse, ChatMessage } from '@voice-agent/shared';
import { fakeAudio, makeApp, makeFakes, multipart } from './helpers.js';

const OK_AUDIO = fakeAudio(4096);

async function ask(
  app: Awaited<ReturnType<typeof makeApp>>['app'],
  fields: Parameters<typeof multipart>[0],
) {
  const body = await multipart(fields);
  return app.inject({ method: 'POST', url: '/api/ask', ...body });
}

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('POST /api/ask', () => {
  it('returns transcript, answer and timings', async () => {
    const { app, stt, llm } = await makeApp({ STT_LANGUAGE: 'hi' });
    const res = await ask(app, { audio: OK_AUDIO, history: '[]' });

    expect(res.statusCode).toBe(200);
    const body = res.json<AskResponse>();
    expect(body).toMatchObject({
      transcript: 'What is the capital of Rajasthan?',
      answer: 'The capital of Rajasthan is Jaipur.',
    });
    expect(body.timingMs.stt).toBeTypeOf('number');
    expect(body.timingMs.llm).toBeTypeOf('number');

    const [audioArg, sttOpts] = stt.transcribe.mock.calls[0]!;
    expect(audioArg.length).toBe(OK_AUDIO.length);
    // The multipart parser strips MIME parameters (";codecs=opus"), keeping the container type.
    expect(sttOpts).toMatchObject({ mimeType: 'audio/webm', language: 'hi' });
    expect(llm.answer).toHaveBeenCalledWith(
      [],
      'What is the capital of Rajasthan?',
      expect.anything(),
    );
  });

  it('works without a history field', async () => {
    const { app, llm } = await makeApp();
    const res = await ask(app, { audio: OK_AUDIO });
    expect(res.statusCode).toBe(200);
    expect(llm.answer.mock.calls[0]![0]).toEqual([]);
  });

  it('caps history to the last MAX_HISTORY_MESSAGES, starting on a user turn', async () => {
    const { app, llm } = await makeApp({ MAX_HISTORY_MESSAGES: '3' });
    const history: ChatMessage[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ];
    const res = await ask(app, { audio: OK_AUDIO, history: JSON.stringify(history) });
    expect(res.statusCode).toBe(200);
    // last 3 = [a1, q2, a2]; leading assistant turn dropped -> [q2, a2]
    expect(llm.answer.mock.calls[0]![0]).toEqual([
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ]);
  });

  it('rejects a recording under 1 KB with 400', async () => {
    const { app, stt } = await makeApp();
    const res = await ask(app, { audio: fakeAudio(500) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Recording too short - hold the button while speaking.' });
    expect(stt.transcribe).not.toHaveBeenCalled();
  });

  it('rejects a recording over 10 MB with 413', async () => {
    const { app } = await makeApp();
    const res = await ask(app, { audio: fakeAudio(10 * 1024 * 1024 + 1) });
    expect(res.statusCode).toBe(413);
    expect(res.json<ApiErrorResponse>().error).toMatch(/too long/i);
  });

  it('rejects a request with no audio with 400', async () => {
    const { app } = await makeApp();
    const res = await ask(app, { history: '[]' });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiErrorResponse>().error).toMatch(/no audio/i);
  });

  it('rejects a non-audio file with 400', async () => {
    const { app } = await makeApp();
    const res = await ask(app, { audio: OK_AUDIO, mimeType: 'text/plain' });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiErrorResponse>().error).toMatch(/unsupported audio format/i);
  });

  it('rejects a non-multipart request with 415', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/ask', payload: { hi: 1 } });
    expect(res.statusCode).toBe(415);
  });

  it.each([
    ['not JSON', '{oops', /not valid JSON/],
    ['wrong shape', '[{"role":"system","content":"x"}]', /invalid shape/],
  ])('rejects history that is %s with 400', async (_label, history, message) => {
    const { app } = await makeApp();
    const res = await ask(app, { audio: OK_AUDIO, history });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiErrorResponse>().error).toMatch(message);
  });

  it('returns 422 when the transcript is empty and skips the LLM', async () => {
    const fakes = makeFakes();
    fakes.stt.transcribe.mockResolvedValue('   ');
    const { app, llm } = await makeApp({}, fakes);
    const res = await ask(app, { audio: OK_AUDIO });
    expect(res.statusCode).toBe(422);
    expect(res.json<ApiErrorResponse>().error).toMatch(/couldn't hear anything/i);
    expect(llm.answer).not.toHaveBeenCalled();
  });

  it('returns 502 on STT failure without leaking the provider error', async () => {
    const fakes = makeFakes();
    fakes.stt.transcribe.mockRejectedValue(new Error('401 invalid key sk-secret-123'));
    const { app } = await makeApp({}, fakes);
    const res = await ask(app, { audio: OK_AUDIO });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'Speech-to-text failed. Please try again.' });
    expect(res.body).not.toContain('sk-secret');
  });

  it('returns 502 on LLM failure without leaking the provider error', async () => {
    const fakes = makeFakes();
    fakes.llm.answer.mockRejectedValue(new Error('upstream exploded at https://internal'));
    const { app } = await makeApp({}, fakes);
    const res = await ask(app, { audio: OK_AUDIO });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'The assistant failed to answer. Please try again.' });
  });

  it('returns 504 when a provider runs past the request deadline', async () => {
    const fakes = makeFakes();
    // A well-behaved provider rejects when the signal it was given aborts.
    fakes.llm.answer.mockImplementation(
      (_history, _text, opts) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const { app } = await makeApp({ REQUEST_TIMEOUT_MS: '50' }, fakes);
    const res = await ask(app, { audio: OK_AUDIO });
    expect(res.statusCode).toBe(504);
  });

  it('rate-limits after RATE_LIMIT_PER_MIN requests', async () => {
    const { app } = await makeApp({ RATE_LIMIT_PER_MIN: '2' });
    await app.inject({ method: 'GET', url: '/api/health' });
    await app.inject({ method: 'GET', url: '/api/health' });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(429);
    expect(res.json<ApiErrorResponse>().error).toMatch(/too many requests/i);
  });

  it('answers unknown routes with a JSON 404', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found.' });
  });
});
