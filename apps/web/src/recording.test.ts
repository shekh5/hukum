import { describe, expect, it } from 'vitest';
import { micErrorMessage, pickMimeType } from './recording';

describe('pickMimeType', () => {
  it('prefers WebM/Opus (Chrome, Firefox)', () => {
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus');
  });

  it('uses MP4 when that is all the browser can record (Safari)', () => {
    expect(pickMimeType((type) => type === 'audio/mp4')).toBe('audio/mp4');
  });

  it('returns undefined so the browser picks its own default', () => {
    expect(pickMimeType(() => false)).toBeUndefined();
  });
});

describe('micErrorMessage', () => {
  it('explains a blocked permission', () => {
    expect(micErrorMessage(new DOMException('denied', 'NotAllowedError'))).toMatch(/blocked/);
  });

  it('explains a missing microphone', () => {
    expect(micErrorMessage(new DOMException('none', 'NotFoundError'))).toMatch(/no microphone/i);
  });
});
