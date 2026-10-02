/**
 * Runtime configuration.
 *
 * The backend URL can be overridden with VITE_API_BASE (the E2E harness runs the
 * backend on another port so it never collides with a running app).
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:48000/api';

/** Accepted image types for import (file pickers and canvas drag & drop). */
export const IMAGE_ACCEPT = 'image/png, image/jpeg, image/webp, image/bmp, image/gif';
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'];
export const IMAGE_FILE_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/i;

/** Archive files shown as text (canvas text overlay) instead of images. */
export const TEXT_FILE_PATTERN = /\.(json|txt|md)$/i;
