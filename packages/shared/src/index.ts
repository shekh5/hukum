import { z } from 'zod';

/** One turn of the conversation, as stored by the web app and sent back on every request. */
export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** The `history` multipart field, after JSON.parse. Hard cap guards against huge payloads. */
export const HistorySchema = z.array(ChatMessageSchema).max(200);

/** 200 response body of POST /api/ask. */
export type AskResponse = {
  transcript: string;
  answer: string;
  timingMs: { stt: number; llm: number };
};

/** Body of every 4xx/5xx response. */
export type ApiErrorResponse = { error: string };
