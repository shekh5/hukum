import type { ChatMessage } from '@voice-agent/shared';

export type { ChatMessage };

export type AnswerOptions = {
  /** Aborted when the request deadline passes. Real providers must pass it to their SDK/fetch. */
  signal?: AbortSignal | undefined;
};

/** Text-in, text-out LLM. The system prompt is fixed when the provider is constructed. */
export interface LlmProvider {
  answer(history: ChatMessage[], userText: string, opts?: AnswerOptions): Promise<string>;
}
