import { useEffect } from 'react';
import { ChatLog } from './components/ChatLog';
import { MicButton } from './components/MicButton';
import { StatusBar } from './components/StatusBar';
import { useVoiceAgent } from './hooks/useVoiceAgent';

export function App() {
  const { phase, messages, timing, error, press, release, reset } = useVoiceAgent();

  // Spacebar = push-to-talk on desktop (PRD F1).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      event.preventDefault(); // no page scroll, no "click" on a focused button
      if (!event.repeat) press();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      void release();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [press, release]);

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h1 className="text-base font-semibold">Voice Agent</h1>
        <button
          type="button"
          onClick={reset}
          disabled={messages.length === 0 && phase !== 'busy'}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:text-slate-400 disabled:hover:bg-transparent dark:text-sky-400 dark:hover:bg-slate-800 dark:disabled:text-slate-600"
        >
          New conversation
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <ChatLog messages={messages} pending={phase === 'busy'} />
      </main>

      <footer className="flex flex-col items-center gap-3 border-t border-slate-200 px-4 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] dark:border-slate-800">
        <StatusBar phase={phase} error={error} timing={timing} />
        <MicButton phase={phase} onPress={press} onRelease={() => void release()} />
      </footer>
    </div>
  );
}
