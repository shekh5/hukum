import type { ChatMessage, LlmProvider } from './types.js';

/** Echoes the question back with the history size, so multi-turn wiring is visible without an API key. */
export class MockLlmProvider implements LlmProvider {
  answer(history: ChatMessage[], userText: string): Promise<string> {
    return Promise.resolve(
      `**Mock answer** to: "${userText}" (history: ${history.length} earlier messages).`,
    );
  }
}
