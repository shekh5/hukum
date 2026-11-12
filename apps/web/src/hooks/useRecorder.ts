import { useCallback, useRef, useState } from 'react';
import { MIN_RECORDING_MS, micErrorMessage, pickMimeType } from '../recording';

export type RecorderState = 'idle' | 'starting' | 'recording';

/** Result of one press: the audio, or a reason nothing was recorded. */
export type RecordingResult =
  { kind: 'audio'; blob: Blob; durationMs: number } | { kind: 'too-short' } | { kind: 'cancelled' };

type Session = {
  stream?: MediaStream;
  recorder?: MediaRecorder;
  chunks: Blob[];
  startedAt: number;
  /** Set when the user releases before the mic finished starting. */
  releasedEarly: boolean;
};

/**
 * Push-to-talk recording with MediaRecorder.
 * `start()` on press, `stop()` on release. The mic is opened per press and fully released after,
 * so the browser's "mic in use" indicator is only on while the button is held.
 */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const session = useRef<Session | null>(null);

  const start = useCallback(async () => {
    if (session.current) return; // already holding
    setError(null);
    const current: Session = { chunks: [], startedAt: 0, releasedEarly: false };
    session.current = current;
    setState('starting');

    try {
      // First call shows the browser's permission prompt (PRD F3).
      current.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      session.current = null;
      setState('idle');
      setError(micErrorMessage(err));
      return;
    }

    if (current.releasedEarly) {
      // Released while the permission prompt / mic start-up was pending: record nothing.
      stopTracks(current.stream);
      session.current = null;
      setState('idle');
      return;
    }

    const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(current.stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) current.chunks.push(event.data);
    };
    current.recorder = recorder;
    current.startedAt = performance.now();
    recorder.start();
    setState('recording');
  }, []);

  const stop = useCallback(async (): Promise<RecordingResult> => {
    const current = session.current;
    if (!current) return { kind: 'cancelled' };

    const recorder = current.recorder;
    if (!recorder) {
      // Still starting: tell start() to abandon this press when getUserMedia resolves.
      current.releasedEarly = true;
      return { kind: 'cancelled' };
    }

    const durationMs = performance.now() - current.startedAt;
    // `stop` fires after the last `dataavailable`, so all chunks are in by then.
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;
    stopTracks(current.stream);
    session.current = null;
    setState('idle');

    if (durationMs < MIN_RECORDING_MS) return { kind: 'too-short' };
    const blob = new Blob(current.chunks, { type: recorder.mimeType || 'audio/webm' });
    return { kind: 'audio', blob, durationMs };
  }, []);

  return { state, error, start, stop };
}

function stopTracks(stream: MediaStream | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}
