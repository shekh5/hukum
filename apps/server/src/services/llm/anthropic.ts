import Anthropic from '@anthropic-ai/sdk';
import type { AnswerOptions, ChatMessage, LlmProvider } from './types.js';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type AnthropicLlmOptions = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  effort: Effort;
  timeoutMs: number;
  /** Test hook: replaces the network. */
  fetch?: typeof globalThis.fetch;
};

/** Shown as the answer when Claude (and its fallback model) decline the request. */
export const REFUSAL_ANSWER = "Sorry, I can't help with that request.";

// Non-streaming cap. Thinking tokens count toward it too, so keep headroom even for short answers.
const MAX_TOKENS = 16_000;

export class AnthropicLlmProvider implements LlmProvider {
  private readonly client: Anthropic;
  private readonly options: AnthropicLlmOptions;

  constructor(options: AnthropicLlmOptions) {
    this.options = options;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      maxRetries: 1, // PRD §7: one automatic retry; the SDK retries only 408/409/429/5xx/network
      timeout: options.timeoutMs,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async answer(history: ChatMessage[], userText: string, opts?: AnswerOptions): Promise<string> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...history.map((message) => ({ role: message.role, content: message.content })),
      { role: 'user', content: userText },
    ];

    const response = await this.client.beta.messages.create(
      {
        model: this.options.model,
        max_tokens: MAX_TOKENS,
        system: this.options.systemPrompt,
        messages,
        // Thinking can't be turned off on current models; effort sets how much it thinks.
        // "low" keeps spoken Q&A fast (PRD §7: LLM < 2 s).
        output_config: { effort: this.options.effort },
        // If a safety classifier declines, Anthropic re-runs the request on its recommended
        // fallback model inside the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      { signal: opts?.signal },
    );

    if (response.stop_reason === 'refusal') return REFUSAL_ANSWER;

    // The response also carries `thinking` blocks; only the text blocks are the answer.
    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
    if (text === '') {
      throw new Error(`Claude returned no text (stop_reason=${response.stop_reason ?? 'null'})`);
    }
    return text;
  }
}
