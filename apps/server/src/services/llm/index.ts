import type { Config } from '../../config.js';
import { AnthropicLlmProvider } from './anthropic.js';
import { MockLlmProvider } from './mock.js';
import type { LlmProvider } from './types.js';

/** Picks the LLM implementation from LLM_PROVIDER. The only place that knows concrete providers. */
export function createLlmProvider(config: Config): LlmProvider {
  switch (config.LLM_PROVIDER) {
    case 'mock':
      return new MockLlmProvider();
    case 'anthropic':
      return new AnthropicLlmProvider({
        // loadConfig already guarantees the key is present for this provider.
        apiKey: config.ANTHROPIC_API_KEY ?? '',
        model: config.LLM_MODEL,
        systemPrompt: config.SYSTEM_PROMPT,
        effort: config.LLM_EFFORT,
        timeoutMs: config.REQUEST_TIMEOUT_MS,
      });
  }
}

export type { LlmProvider, ChatMessage } from './types.js';
