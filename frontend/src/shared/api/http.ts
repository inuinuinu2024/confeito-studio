/**
 * Low-level HTTP helpers for the backend API.
 *
 * Backend errors always look like `{"detail": string | {message, raw_response}}`
 * (see backend/src/app/errors.py); `ApiError` keeps every part of it.
 */
import { API_BASE } from '../config';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The `detail` field as returned (string, object, or undefined). */
    readonly detail: unknown,
    /** Parsed response body, or `{ error: text }` when the body was not JSON. */
    readonly body: unknown,
    /** Upstream (Gemini) response forwarded by the backend in `detail.raw_response`. */
    readonly rawResponse: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Converts a non-OK response into an ApiError. */
export async function toApiError(res: Response): Promise<ApiError> {
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    return new ApiError(text || `HTTP ${res.status}`, res.status, undefined, { error: text });
  }
  const detail = body?.detail;
  if (typeof detail === 'string') return new ApiError(detail, res.status, detail, body);
  if (detail && typeof detail === 'object') {
    return new ApiError(
      detail.message || JSON.stringify(detail),
      res.status,
      detail,
      body,
      detail.raw_response ?? null,
    );
  }
  return new ApiError(text, res.status, detail, body);
}

/** fetch() against API_BASE; throws ApiError for non-2xx responses. */
export async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw await toApiError(res);
  return res;
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request(path, init)).json() as Promise<T>;
}

export function postJson<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  return requestJson<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export function postForm<T>(path: string, form: FormData): Promise<T> {
  return requestJson<T>(path, { method: 'POST', body: form });
}

type FormValue = string | number | boolean | Blob | [Blob, string] | null | undefined;

/** Builds FormData; `[blob, filename]` tuples become file parts, null/undefined are skipped. */
export function formData(fields: Record<string, FormValue>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) form.append(key, value[0], value[1]);
    else if (value instanceof Blob) form.append(key, value);
    else form.append(key, String(value));
  }
  return form;
}
