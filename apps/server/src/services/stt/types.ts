export type TranscribeOptions = {
  /** MIME type the browser recorded in, e.g. "audio/webm;codecs=opus" or "audio/mp4". */
  mimeType: string;
  /** "en", "hi", or undefined for provider auto-detect. */
  language?: string | undefined;
  /** Aborted when the request deadline passes. Real providers must pass it to their SDK/fetch. */
  signal?: AbortSignal | undefined;
};

/** Speech-to-text. Implementations live next to this file; routes only see this interface. */
export interface SttProvider {
  transcribe(audio: Buffer, opts: TranscribeOptions): Promise<string>;
}
