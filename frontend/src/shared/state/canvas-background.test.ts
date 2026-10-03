import { describe, expect, it } from 'vitest';
import { DEFAULT_BG_COLOR, normalizeBgColor } from './canvas-background';

describe('normalizeBgColor', () => {
  it('keeps a listed colour', () => {
    expect(normalizeBgColor('#000000')).toBe('#000000');
    expect(normalizeBgColor('checkerboard')).toBe('checkerboard');
  });

  it('falls back to the default for unknown or empty values', () => {
    expect(DEFAULT_BG_COLOR).toBe('checkerboard');
    expect(normalizeBgColor('')).toBe(DEFAULT_BG_COLOR);
    expect(normalizeBgColor('#123456')).toBe(DEFAULT_BG_COLOR);
    expect(normalizeBgColor('transparent')).toBe(DEFAULT_BG_COLOR);
  });
});
