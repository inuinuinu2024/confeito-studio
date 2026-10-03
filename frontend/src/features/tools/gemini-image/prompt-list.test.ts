import { describe, expect, it } from 'vitest';
import { findByName, MAX_NAME_LENGTH, previewText, promptInputError } from './prompt-list';

const prompts = [
  { id: 'a', name: '着彩', text: '着彩して' },
  { id: 'b', name: '表情差分', text: '表情を変えて' },
];

describe('promptInputError', () => {
  it('accepts a name and a text', () => {
    expect(promptInputError(' 着彩 ', '着彩して')).toBeNull();
  });

  it('needs a name within the limit and a text', () => {
    expect(promptInputError('  ', 'text')).toBe('名前を入力してください。');
    expect(promptInputError('x'.repeat(MAX_NAME_LENGTH + 1), 'text')).toBe('名前は 100 文字以内にしてください。');
    expect(promptInputError('x'.repeat(MAX_NAME_LENGTH), 'text')).toBeNull();
    expect(promptInputError('name', ' \n ')).toBe('プロンプトの本文を入力してください。');
  });
});

describe('findByName', () => {
  it('compares the trimmed name', () => {
    expect(findByName(prompts, ' 着彩 ')?.id).toBe('a');
    expect(findByName(prompts, '着')).toBeUndefined();
  });

  it('skips the prompt being edited', () => {
    expect(findByName(prompts, '着彩', 'a')).toBeUndefined();
    expect(findByName(prompts, '着彩', 'b')?.id).toBe('a');
  });
});

describe('previewText', () => {
  it('shows the first non-blank lines', () => {
    expect(previewText('one\n\ntwo\r\nthree')).toBe('one\ntwo…');
    expect(previewText('one\ntwo')).toBe('one\ntwo');
    expect(previewText('one', 1)).toBe('one');
  });
});
