import type { AskResponse } from '@voice-agent/shared';
import type { Phase } from '../hooks/useVoiceAgent';

type Props = { phase: Phase; error: string | null; timing: AskResponse['timingMs'] | null };

const TEXT: Record<Phase, string> = {
  idle: 'Hold the button or Space to talk',
  recording: 'Listening…',
  busy: 'Transcribing and thinking…',
};

/** One line of status (PRD F2/F5) or the latest error (F3/user story 5), plus debug timings (F9). */
export function StatusBar({ phase, error, timing }: Props) {
  const showError = error !== null && phase === 'idle';
  return (
    <div className="flex min-h-11 flex-col items-center justify-center text-center" role="status">
      <p
        className={
          showError
            ? 'text-sm font-medium text-rose-600 dark:text-rose-400'
            : 'text-sm text-slate-600 dark:text-slate-300'
        }
      >
        {showError ? error : TEXT[phase]}
      </p>
      {timing && (
        <p className="mt-0.5 font-mono text-[11px] text-slate-400 dark:text-slate-500">
          STT {timing.stt} ms · LLM {timing.llm} ms
        </p>
      )}
    </div>
  );
}
