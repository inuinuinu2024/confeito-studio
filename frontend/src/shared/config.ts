/**
 * Runtime configuration.
 *
 * The backend URL can be overridden with VITE_API_BASE (the E2E harness runs the
 * backend on another port so it never collides with a running app).
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:48000/api';

/** Image files accepted by canvas drag & drop (the same types as the backend file dialog). */
export const IMAGE_FILE_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/i;

/**
 * Tools renamed since: results saved under the old name (info.json `tool`, stack ids in .flow.json) are shown and
 * grouped under the new one. The saved files are not rewritten.
 */
export const RENAMED_TOOLS: Readonly<Record<string, string>> = { 'Nano Banana画像生成': 'AI画像生成' };

/** Archive files shown as text (canvas text overlay) instead of images. */
export const TEXT_FILE_PATTERN = /\.(json|txt|md)$/i;
