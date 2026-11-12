import { useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import type { ChatMessage } from '@voice-agent/shared';

type Props = { messages: ChatMessage[]; pending: boolean };

/** "You" (transcript) and "Agent" (Markdown answer) bubbles, newest at the bottom (PRD F6). */
export function ChatLog({ messages, pending }: Props) {
  const bottom = useRef<HTMLLIElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, pending]);

  if (messages.length === 0 && !pending) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-slate-500 dark:text-slate-400">
        <p className="text-lg font-medium text-slate-700 dark:text-slate-200">Ask me anything</p>
        <p className="text-sm">
          Hold the mic button (or Space) and speak in English, Hindi or Hinglish.
        </p>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-4 px-4 py-6" aria-live="polite">
      {messages.map((message, index) => (
        <li
          key={index}
          className={
            message.role === 'user' ? 'flex flex-col items-end' : 'flex flex-col items-start'
          }
        >
          <span className="mb-1 px-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            {message.role === 'user' ? 'You' : 'Agent'}
          </span>
          {message.role === 'user' ? (
            <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-sky-600 px-4 py-2.5 text-white">
              {message.content}
            </p>
          ) : (
            <div className="markdown max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 text-slate-800 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700">
              <Markdown>{message.content}</Markdown>
            </div>
          )}
        </li>
      ))}
      {pending && (
        <li className="flex flex-col items-start" aria-label="Agent is thinking">
          <span className="mb-1 px-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Agent
          </span>
          <span className="flex gap-1 rounded-2xl rounded-bl-sm bg-white px-4 py-3.5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="size-2 animate-bounce rounded-full bg-slate-400"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
        </li>
      )}
      <li ref={bottom} aria-hidden />
    </ol>
  );
}
