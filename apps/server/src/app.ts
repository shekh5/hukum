import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { ApiErrorResponse } from '@voice-agent/shared';
import { toPublicError } from './errors.js';
import { MAX_AUDIO_BYTES, registerAskRoute, type AskDeps } from './routes/ask.js';
import { registerHealthRoute } from './routes/health.js';

/**
 * Build the Fastify app without starting it. Providers are passed in, so tests inject
 * fakes and `index.ts` injects the ones chosen by env vars.
 */
export async function buildApp(deps: AskDeps): Promise<FastifyInstance> {
  const { config } = deps;

  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.LOG_LEVEL },
    // Max time to receive the full upload from the browser.
    requestTimeout: config.REQUEST_TIMEOUT_MS,
  });

  await app.register(cors, { origin: config.CORS_ORIGIN });
  await app.register(rateLimit, { max: config.RATE_LIMIT_PER_MIN, timeWindow: '1 minute' });
  await app.register(multipart, {
    limits: {
      fileSize: MAX_AUDIO_BYTES,
      files: 1,
      fields: 4,
      parts: 5,
      fieldSize: 256 * 1024, // history JSON; 20 messages fit easily
    },
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const { statusCode, message } = toPublicError(error);
    if (statusCode >= 500) request.log.error({ err: error }, 'request failed');
    const body: ApiErrorResponse = { error: message };
    return reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    const body: ApiErrorResponse = { error: 'Not found.' };
    return reply.status(404).send(body);
  });

  registerHealthRoute(app);
  registerAskRoute(app, deps);

  return app;
}
