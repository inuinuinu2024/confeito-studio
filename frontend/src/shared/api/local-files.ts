/** /api/local-files — the file dialog of the PC running the backend (backend/src/app/routers/local_files.py). */
import { postJson, request } from './http';

/** Resolves when `path` is an existing folder (or empty); ApiError 404 otherwise. */
export async function checkFolder(path: string): Promise<void> {
  await postJson('/local-files/check-folder', { path });
}

/** Opens the OS file dialog in `initialDir` (empty = its default); the chosen image, or null when cancelled. */
export async function pickImageFile(initialDir: string, signal?: AbortSignal): Promise<File | null> {
  const res = await request('/local-files/pick-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initial_dir: initialDir }),
    signal,
  });
  if (res.status === 204) return null;
  const blob = await res.blob();
  const name = decodeURIComponent(res.headers.get('X-File-Name') ?? 'image.png');
  return new File([blob], name, { type: blob.type });
}
