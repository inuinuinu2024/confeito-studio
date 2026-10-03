/** Shared constants of the Gemini image tools (currently used by nano-banana-pro). */

export const IMPORTANT_IMAGE_NOTE = 'これはユーザにより重要画像に設定されている。\n';

/** Longest side of an image sent to Gemini; larger ones are scaled down (keeps the request under its size limit). */
export const MAX_UPLOAD_SIDE = 2048;
