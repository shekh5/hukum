import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { capHistory } from '../src/history.js';

describe('loadConfig', () => {
  it('boots with mock providers and no keys', () => {
    const config = loadConfig({});
    expect(config.STT_PROVIDER).toBe('mock');
    expect(config.LLM_PROVIDER).toBe('mock');
    expect(config.PORT).toBe(8787);
    expect(config.MAX_HISTORY_MESSAGES).toBe(20);
  });

  it('treats empty values as unset (STT_LANGUAGE= means auto-detect)', () => {
    expect(loadConfig({ STT_LANGUAGE: '' }).STT_LANGUAGE).toBeUndefined();
  });

  it('lists every missing key for the chosen real providers', () => {
    expect(() => loadConfig({ STT_PROVIDER: 'openai', LLM_PROVIDER: 'anthropic' })).toThrow(
      /OPENAI_API_KEY[\s\S]*ANTHROPIC_API_KEY/,
    );
  });

  it('rejects an unknown provider', () => {
    expect(() => loadConfig({ STT_PROVIDER: 'whisperx' })).toThrow(/STT_PROVIDER/);
  });
});

describe('capHistory', () => {
  const q = (content: string) => ({ role: 'user' as const, content });
  const a = (content: string) => ({ role: 'assistant' as const, content });

  it('returns [] when max is 0', () => {
    expect(capHistory([q('1'), a('1')], 0)).toEqual([]);
  });

  it('keeps everything under the cap', () => {
    expect(capHistory([q('1'), a('1')], 20)).toEqual([q('1'), a('1')]);
  });

  it('drops a leading assistant message after slicing', () => {
    expect(capHistory([q('1'), a('1'), q('2')], 2)).toEqual([q('2')]);
  });
});
