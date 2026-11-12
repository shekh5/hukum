import { config as loadDotenv } from 'dotenv';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createLlmProvider } from './services/llm/index.js';
import { createSttProvider } from './services/stt/index.js';

// The single .env lives at the repo root, two levels above apps/server/src.
loadDotenv({ path: new URL('../../../.env', import.meta.url), quiet: true });

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const app = await buildApp({
    config,
    stt: createSttProvider(config),
    llm: createLlmProvider(config),
  });

  const shutdown = (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info({ stt: config.STT_PROVIDER, llm: config.LLM_PROVIDER }, 'voice agent server ready');
}

main().catch((error: unknown) => {
  // Config errors are already human-readable; print them without a stack trace.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
