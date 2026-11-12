import type { Phase } from '../hooks/useVoiceAgent';

type Props = { phase: Phase; onPress: () => void; onRelease: () => void };

/** Hold to talk (PRD F1/F2). Pointer events cover mouse, touch and pen with one code path. */
export function MicButton({ phase, onPress, onRelease }: Props) {
  const recording = phase === 'recording';
  return (
    <button
      type="button"
      aria-label={recording ? 'Release to send' : 'Hold to talk'}
      aria-pressed={recording}
      disabled={phase === 'busy'}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Keep receiving pointerup even if the finger slides off the button.
        event.currentTarget.setPointerCapture(event.pointerId);
        onPress();
      }}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onContextMenu={(event) => event.preventDefault()} // no long-press menu on mobile
      className={[
        'relative flex size-20 touch-none items-center justify-center rounded-full select-none',
        'transition-all duration-150 outline-none focus-visible:ring-4 focus-visible:ring-sky-400/50',
        'disabled:cursor-not-allowed disabled:opacity-40',
        recording
          ? 'scale-115 bg-rose-500 text-white shadow-lg shadow-rose-500/40'
          : 'bg-sky-600 text-white shadow-md hover:bg-sky-500 active:scale-105',
      ].join(' ')}
    >
      {recording && (
        <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/40" aria-hidden />
      )}
      <MicIcon />
    </button>
  );
}

function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="relative size-8"
      fill="none"
      stroke="currentColor"
      aria-hidden
    >
      <rect x="9" y="3" width="6" height="11" rx="3" strokeWidth="2" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
