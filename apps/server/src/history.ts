import type { ChatMessage } from '@voice-agent/shared';

/**
 * Keep only the last `max` messages (cost control), then drop any leading assistant
 * messages so the history always starts with a user turn — some LLM APIs (Anthropic) reject
 * a conversation that opens with the assistant.
 */
export function capHistory(history: ChatMessage[], max: number): ChatMessage[] {
  if (max <= 0) return [];
  const recent = history.slice(-max);
  const firstUser = recent.findIndex((message) => message.role === 'user');
  return firstUser === -1 ? [] : recent.slice(firstUser);
}
