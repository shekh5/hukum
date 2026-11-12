import type { Config } from '../../config.js';
import { MockSttProvider } from './mock.js';
import { OpenAiSttProvider } from './openai.js';
import type { SttProvider } from './types.js';

/** Picks the STT implementation from STT_PROVIDER. The only place that knows concrete providers. */
export function createSttProvider(config: Config): SttProvider {
  switch (config.STT_PROVIDER) {
    case 'mock':
      return new MockSttProvider();
    case 'openai':
      return new OpenAiSttProvider({
        // loadConfig already guarantees the key is present for this provider.
        apiKey: config.OPENAI_API_KEY ?? '',
        model: config.STT_MODEL,
        timeoutMs: config.REQUEST_TIMEOUT_MS,
      });
    case 'deepgram':
      throw new Error('STT_PROVIDER=deepgram is not implemented yet. Use openai or mock.');
  }
}

export type { SttProvider } from './types.js';
