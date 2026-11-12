import { vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import type { LlmProvider } from '../src/services/llm/index.js';
import type { SttProvider } from '../src/services/stt/index.js';

export function makeFakes() {
  const stt = {
    transcribe: vi
      .fn<SttProvider['transcribe']>()
      .mockResolvedValue('What is the capital of Rajasthan?'),
  };
  const llm = {
    answer: vi.fn<LlmProvider['answer']>().mockResolvedValue('The capital of Rajasthan is Jaipur.'),
  };
  return { stt, llm };
}

export async function makeApp(
  overrides: Record<string, string> = {},
  fakes = makeFakes(),
): Promise<{ app: FastifyInstance; config: Config } & ReturnType<typeof makeFakes>> {
  const config = loadConfig({ NODE_ENV: 'test', ...overrides });
  const app = await buildApp({ config, stt: fakes.stt, llm: fakes.llm });
  return { app, config, ...fakes };
}

/** Bytes that look like a recording of `size` bytes. Content is irrelevant to fake providers. */
export function fakeAudio(size: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(size)).fill(7);
}

/** Encode a real multipart/form-data body using the platform FormData encoder. */
export async function multipart(fields: {
  audio?: Uint8Array<ArrayBuffer>;
  mimeType?: string;
  history?: string;
  extra?: Record<string, string>;
}): Promise<{ payload: Buffer; headers: Record<string, string> }> {
  const form = new FormData();
  if (fields.audio) {
    const type = fields.mimeType ?? 'audio/webm;codecs=opus';
    form.append('audio', new Blob([fields.audio], { type }), 'recording.webm');
  }
  if (fields.history !== undefined) form.append('history', fields.history);
  for (const [name, value] of Object.entries(fields.extra ?? {})) form.append(name, value);

  const request = new Request('http://test.local', { method: 'POST', body: form });
  return {
    payload: Buffer.from(await request.arrayBuffer()),
    headers: { 'content-type': request.headers.get('content-type') ?? '' },
  };
}
