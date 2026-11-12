/** Formats in order of preference. Chrome/Firefox take the first; Safari only supports mp4. */
const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

/** First format this browser can record, or undefined to let the browser pick its default. */
export function pickMimeType(isTypeSupported: (type: string) => boolean): string | undefined {
  return PREFERRED_TYPES.find((type) => isTypeSupported(type));
}

/** Presses shorter than this are treated as accidental taps and never sent. */
export const MIN_RECORDING_MS = 400;

/** Turn a getUserMedia failure into a message the user can act on. */
export function micErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access is blocked. Allow it in the browser address bar, then try again.';
  }
  if (name === 'NotFoundError') return 'No microphone found. Plug one in and try again.';
  if (name === 'NotReadableError') return 'The microphone is busy in another app.';
  if (typeof navigator !== 'undefined' && !navigator.mediaDevices) {
    return 'Microphone needs a secure page (https or localhost).';
  }
  return 'Could not start the microphone.';
}
