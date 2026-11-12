import { describe, expect, it, vi } from 'vitest';
import { AnthropicLlmProvider, REFUSAL_ANSWER } from '../src/services/llm/anthropic.js';
import { OpenAiSttProvider } from '../src/services/stt/openai.js';

/**
 * Fake network for the SDKs. Each call returns the next queued response and records the request,
 * so the tests check the exact HTTP the SDK would send, with no API key and no internet.
 */
function fakeFetch(...responses: Array<{ status?: number; body: unknown }>) {
  const requests: Request[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
    const request = new Request(input, init);
    // The OpenAI SDK probes the fetch function with a local `data:` URL first; not an API call.
    if (request.url.startsWith('data:')) return globalThis.fetch(request);
    requests.push(request);
    if (request.signal.aborted) return Promise.reject(request.signal.reason as Error);
    const next = responses.shift() ?? { status: 500, body: { error: 'no more fake responses' } };
    return Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status ?? 200,
        // Tell the SDK to retry immediately instead of backing off.
        headers: { 'content-type': 'application/json', 'retry-after-ms': '0' },
      }),
    );
  });
  return { fetch, requests };
}

const SERVER_ERROR = { status: 500, body: { error: { type: 'api_error', message: 'boom' } } };

describe('OpenAiSttProvider', () => {
  const make = (fetch: typeof globalThis.fetch) =>
    new OpenAiSttProvider({
      apiKey: 'test-key',
      model: 'gpt-4o-mini-transcribe',
      timeoutMs: 5000,
      fetch,
    });

  it('uploads the audio with a matching extension, model and language', async () => {
    const { fetch, requests } = fakeFetch({ body: { text: 'नमस्ते, Jaipur kaisa hai?' } });
    const text = await make(fetch).transcribe(Buffer.from('fake-audio'), {
      mimeType: 'audio/mp4',
      language: 'hi',
    });

    expect(text).toBe('नमस्ते, Jaipur kaisa hai?');
    const request = requests[0]!;
    expect(request.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    const form = await request.formData();
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(form.get('language')).toBe('hi');
    expect(form.get('response_format')).toBe('json');
    expect((form.get('file') as File).name).toBe('recording.mp4');
  });

  it('omits language when it is auto-detect', async () => {
    const { fetch, requests } = fakeFetch({ body: { text: 'hello' } });
    await make(fetch).transcribe(Buffer.from('x'), { mimeType: 'audio/webm' });
    expect((await requests[0]!.formData()).has('language')).toBe(false);
  });

  it('retries once on a server error, then succeeds', async () => {
    const { fetch, requests } = fakeFetch(SERVER_ERROR, { body: { text: 'second try' } });
    await expect(
      make(fetch).transcribe(Buffer.from('x'), { mimeType: 'audio/webm' }),
    ).resolves.toBe('second try');
    expect(requests).toHaveLength(2);
  });

  it('gives up after one retry', async () => {
    const { fetch, requests } = fakeFetch(SERVER_ERROR, SERVER_ERROR, {
      body: { text: 'never reached' },
    });
    await expect(
      make(fetch).transcribe(Buffer.from('x'), { mimeType: 'audio/webm' }),
    ).rejects.toThrow();
    expect(requests).toHaveLength(2);
  });

  it('rejects a format OpenAI cannot read, without calling the API', async () => {
    const { fetch, requests } = fakeFetch();
    await expect(
      make(fetch).transcribe(Buffer.from('x'), { mimeType: 'audio/aac' }),
    ).rejects.toThrow(/audio\/aac/);
    expect(requests).toHaveLength(0);
  });
});

describe('AnthropicLlmProvider', () => {
  const make = (fetch: typeof globalThis.fetch) =>
    new AnthropicLlmProvider({
      apiKey: 'test-key',
      model: 'claude-sonnet-5-5',
      systemPrompt: 'SYSTEM',
      effort: 'low',
      timeoutMs: 5000,
      fetch,
    });

  const message = (content: unknown[], stopReason = 'end_turn') => ({
    body: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  });

  it('sends system prompt, history + new question, effort and fallbacks; returns only text', async () => {
    const { fetch, requests } = fakeFetch(
      message([
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: 'The capital is ' },
        { type: 'text', text: 'Jaipur.' },
      ]),
    );
    const answer = await make(fetch).answer(
      [
        { role: 'user', content: 'Tell me about Rajasthan' },
        { role: 'assistant', content: 'It is a state in India.' },
      ],
      'What is its capital?',
    );

    expect(answer).toBe('The capital is Jaipur.');
    const request = requests[0]!;
    expect(request.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(request.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(await request.json()).toMatchObject({
      model: 'claude-sonnet-5-5',
      system: 'SYSTEM',
      output_config: { effort: 'low' },
      fallbacks: 'default',
      messages: [
        { role: 'user', content: 'Tell me about Rajasthan' },
        { role: 'assistant', content: 'It is a state in India.' },
        { role: 'user', content: 'What is its capital?' },
      ],
    });
  });

  it('returns a polite answer when the request is refused', async () => {
    const { fetch } = fakeFetch(message([], 'refusal'));
    await expect(make(fetch).answer([], 'something disallowed')).resolves.toBe(REFUSAL_ANSWER);
  });

  it('throws when Claude returns no text', async () => {
    const { fetch } = fakeFetch(message([{ type: 'thinking', thinking: '', signature: 's' }]));
    await expect(make(fetch).answer([], 'hi')).rejects.toThrow(/no text/);
  });

  it('retries once on a server error, then succeeds', async () => {
    const { fetch, requests } = fakeFetch(SERVER_ERROR, message([{ type: 'text', text: 'ok' }]));
    await expect(make(fetch).answer([], 'hi')).resolves.toBe('ok');
    expect(requests).toHaveLength(2);
  });

  it('does not retry a bad API key', async () => {
    const { fetch, requests } = fakeFetch({
      status: 401,
      body: {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      },
    });
    await expect(make(fetch).answer([], 'hi')).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  it('stops when the request deadline signal aborts', async () => {
    const { fetch } = fakeFetch(message([{ type: 'text', text: 'too late' }]));
    await expect(make(fetch).answer([], 'hi', { signal: AbortSignal.abort() })).rejects.toThrow();
  });
});
