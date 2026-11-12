import { z } from 'zod';

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant. The user is speaking; their words were transcribed by speech-to-text, ' +
  'so ignore small transcription errors and filler words. Answer clearly and concisely.';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    STT_PROVIDER: z.enum(['mock', 'openai', 'deepgram']).default('mock'),
    LLM_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),

    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    DEEPGRAM_API_KEY: z.string().optional(),

    STT_MODEL: z.string().default('gpt-4o-mini-transcribe'),
    LLM_MODEL: z.string().default('claude-sonnet-5-5'),
    LLM_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),

    STT_LANGUAGE: z.enum(['en', 'hi']).optional(),
    SYSTEM_PROMPT: z.string().min(1).default(DEFAULT_SYSTEM_PROMPT),
    MAX_HISTORY_MESSAGES: z.coerce.number().int().min(0).max(100).default(20),

    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(30),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1).default(30_000),
  })
  .superRefine((env, ctx) => {
    const requireKey = (
      key: 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'DEEPGRAM_API_KEY',
      why: string,
    ) => {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `required when ${why}` });
    };
    if (env.STT_PROVIDER === 'openai') requireKey('OPENAI_API_KEY', 'STT_PROVIDER=openai');
    if (env.STT_PROVIDER === 'deepgram') requireKey('DEEPGRAM_API_KEY', 'STT_PROVIDER=deepgram');
    if (env.LLM_PROVIDER === 'anthropic') requireKey('ANTHROPIC_API_KEY', 'LLM_PROVIDER=anthropic');
  });

export type Config = z.infer<typeof EnvSchema>;

/**
 * Parse and validate env vars. Throws one readable error listing every problem,
 * so the server refuses to boot with a bad .env instead of failing on the first request.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  // `.env` lines like `STT_LANGUAGE=` arrive as "" — treat them as "not set" so defaults apply.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
