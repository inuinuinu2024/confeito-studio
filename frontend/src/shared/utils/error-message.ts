/**
 * Splits an error into the Japanese message shown to the user and the original system text
 * (API response, exception) shown below it in the error toast (docs/specs/notifications.md).
 */
import { ApiError } from '../api/http';

export interface ErrorDescription {
  /** Japanese message for the user. */
  message: string;
  /** Original text from the system (HTTP status, upstream response, exception), if any. */
  detail?: string;
}

/** Error written by the app itself: `message` is already Japanese, `detail` is the original text if any. */
export class AppMessageError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'AppMessageError';
  }
}

export const MESSAGES = {
  backendUnreachable: 'バックエンドに接続できませんでした。起動しているか確認してください。',
  badRequest: 'リクエストの内容が正しくありません。',
  backendError: 'バックエンドでエラーが発生しました。',
  unexpected: '予期しないエラーが発生しました。',
} as const;

/** Strings as-is, errors as "<name>: <message>", everything else as pretty-printed JSON. */
export function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

const isPresent = (value: unknown) => value !== null && value !== undefined && value !== '';

function describeApiError(err: ApiError): ErrorDescription {
  const status = `HTTP ${err.status}`;
  const { detail } = err;
  if (typeof detail === 'string') return { message: detail, detail: status };
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && 'message' in detail) {
    const raw = isPresent(err.rawResponse) ? `\n${stringify(err.rawResponse)}` : '';
    return { message: String((detail as { message: unknown }).message), detail: `${status}${raw}` };
  }
  return {
    message: err.status >= 500 ? MESSAGES.backendError : MESSAGES.badRequest,
    detail: `${status}\n${stringify(err.body)}`,
  };
}

export function describeError(err: unknown): ErrorDescription {
  if (err instanceof ApiError) return describeApiError(err);
  if (err instanceof AppMessageError) {
    return isPresent(err.detail) ? { message: err.message, detail: stringify(err.detail) } : { message: err.message };
  }
  // fetch() rejects with a TypeError when the backend cannot be reached.
  if (err instanceof TypeError && /fetch/i.test(err.message)) {
    return { message: MESSAGES.backendUnreachable, detail: `${err.name}: ${err.message}` };
  }
  return { message: MESSAGES.unexpected, detail: stringify(err) };
}
