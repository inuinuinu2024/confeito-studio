import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/http';
import { AppMessageError, describeError, MESSAGES } from './error-message';

describe('describeError', () => {
  it('uses the backend message of a string detail and keeps the status as the original text', () => {
    const err = new ApiError('panels.json が見つかりません。', 400, 'panels.json が見つかりません。', {});
    expect(describeError(err)).toEqual({ message: 'panels.json が見つかりません。', detail: 'HTTP 400' });
  });

  it('adds the upstream raw_response to the original text', () => {
    const raw = { error: { code: 400, status: 'INVALID_ARGUMENT' } };
    const err = new ApiError(
      'Gemini API エラー (400)',
      400,
      { message: 'Gemini API エラー (400)', raw_response: raw },
      {},
      raw,
    );
    expect(describeError(err)).toEqual({
      message: 'Gemini API エラー (400)',
      detail: `HTTP 400\n${JSON.stringify(raw, null, 2)}`,
    });
  });

  it('falls back to a Japanese message for details the backend did not write (e.g. 422 validation)', () => {
    const body = { detail: [{ loc: ['body', 'name'], msg: 'Field required' }] };
    const err = new ApiError('[...]', 422, body.detail, body);
    expect(describeError(err)).toEqual({
      message: MESSAGES.badRequest,
      detail: `HTTP 422\n${JSON.stringify(body, null, 2)}`,
    });
    expect(describeError(new ApiError('oops', 502, undefined, { error: 'oops' })).message).toBe(MESSAGES.backendError);
  });

  it('explains a failed fetch as an unreachable backend', () => {
    expect(describeError(new TypeError('Failed to fetch'))).toEqual({
      message: MESSAGES.backendUnreachable,
      detail: 'TypeError: Failed to fetch',
    });
  });

  it('shows messages the app wrote itself as they are', () => {
    expect(describeError(new AppMessageError('画像の変換に失敗しました。'))).toEqual({
      message: '画像の変換に失敗しました。',
    });
    expect(describeError(new AppMessageError('保存できませんでした。', new Error('denied')))).toEqual({
      message: '保存できませんでした。',
      detail: 'Error: denied',
    });
    expect(describeError(new AppMessageError('保存できませんでした。', 'NotAllowedError: denied')).detail).toBe(
      'NotAllowedError: denied',
    );
  });

  it('keeps the original text of unexpected errors', () => {
    expect(describeError(new RangeError('bad size'))).toEqual({
      message: MESSAGES.unexpected,
      detail: 'RangeError: bad size',
    });
    expect(describeError('boom')).toEqual({ message: MESSAGES.unexpected, detail: 'boom' });
  });
});
