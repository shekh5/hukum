import OpenAI, { toFile } from 'openai';
import type { SttProvider, TranscribeOptions } from './types.js';

/**
 * OpenAI needs a filename with the right extension to detect the format. Browsers record in
 * different containers: Chrome/Firefox send WebM or Ogg, Safari sends MP4.
 */
const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'video/mp4': 'mp4',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
};

export type OpenAiSttOptions = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  /** Test hook: replaces the network. */
  fetch?: typeof globalThis.fetch;
};

export class OpenAiSttProvider implements SttProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAiSttOptions) {
    this.model = options.model;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      maxRetries: 1, // PRD §7: one automatic retry; the SDK retries only 408/409/429/5xx/network
      timeout: options.timeoutMs,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async transcribe(audio: Buffer, opts: TranscribeOptions): Promise<string> {
    const extension = EXTENSIONS[opts.mimeType];
    if (!extension) throw new Error(`OpenAI STT does not accept audio type "${opts.mimeType}"`);

    const file = await toFile(audio, `recording.${extension}`, { type: opts.mimeType });
    const result = await this.client.audio.transcriptions.create(
      {
        file,
        model: this.model,
        response_format: 'json',
        ...(opts.language ? { language: opts.language } : {}),
      },
      { signal: opts.signal },
    );
    return result.text;
  }
}
