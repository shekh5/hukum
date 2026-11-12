import { useCallback, useRef, useState } from 'react';
import type { AskResponse, ChatMessage } from '@voice-agent/shared';
import { AskError, askQuestion } from '../api';
import { useRecorder } from './useRecorder';

export type Phase = 'idle' | 'recording' | 'busy';

/**
 * The whole push-to-talk turn: press -> record -> release -> POST /api/ask -> append to chat.
 * Conversation history lives only here, in memory (PRD F7); "New conversation" clears it (F8).
 */
export function useVoiceAgent() {
  const recorder = useRecorder();
  const { start: startRecording, stop: stopRecording } = recorder;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [timing, setTiming] = useState<AskResponse['timingMs'] | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const phase: Phase = busy ? 'busy' : recorder.state === 'idle' ? 'idle' : 'recording';

  const press = useCallback(() => {
    if (busy) return; // mic is disabled while a question is in flight (PRD F5)
    setRequestError(null);
    void startRecording();
  }, [busy, startRecording]);

  const release = useCallback(async () => {
    const result = await stopRecording();
    if (result.kind === 'cancelled') return;
    if (result.kind === 'too-short') {
      setRequestError('Recording too short - hold the button while speaking.');
      return;
    }

    const controller = new AbortController();
    inflight.current = controller;
    setBusy(true);
    try {
      const response = await askQuestion(result.blob, messages, controller.signal);
      setMessages((previous) => [
        ...previous,
        { role: 'user', content: response.transcript },
        { role: 'assistant', content: response.answer },
      ]);
      setTiming(response.timingMs);
    } catch (error) {
      if (controller.signal.aborted) return; // "New conversation" cancelled it
      setRequestError(error instanceof AskError ? error.message : 'Something went wrong.');
    } finally {
      if (inflight.current === controller) {
        inflight.current = null;
        setBusy(false);
      }
    }
  }, [messages, stopRecording]);

  const reset = useCallback(() => {
    inflight.current?.abort();
    inflight.current = null;
    setBusy(false);
    setMessages([]);
    setTiming(null);
    setRequestError(null);
  }, []);

  return {
    phase,
    messages,
    timing,
    error: recorder.error ?? requestError,
    press,
    release,
    reset,
  };
}
