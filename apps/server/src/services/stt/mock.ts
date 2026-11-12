import type { SttProvider, TranscribeOptions } from './types.js';

/** Returns a fixed transcript describing the upload. Lets the whole pipeline run with no API keys. */
export class MockSttProvider implements SttProvider {
  transcribe(audio: Buffer, opts: TranscribeOptions): Promise<string> {
    const lang = opts.language ?? 'auto';
    return Promise.resolve(
      `Mock transcript (${audio.length} bytes, ${opts.mimeType}, language ${lang}).`,
    );
  }
}
