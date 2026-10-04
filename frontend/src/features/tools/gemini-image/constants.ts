/** Shared constants of the Gemini image tools (currently used by nano-banana-pro). */

export const IMPORTANT_IMAGE_NOTE = 'この画像は重要。ほかの参照画像より優先して反映すること。\n';

/** What the model should take from a reference image of each type (by its short name, e.g. "Object"). */
export const ZONE_INSTRUCTIONS: Record<string, string> = {
  Object: 'この画像の物体・要素の形とデザインを正確に反映すること。',
  Character: 'この人物と同じキャラクター（顔・髪型・服装）として描くこと。',
  Style: 'この画像の画風・色使い・タッチを参考にすること（描かれている内容は写さない）。',
};

/** Heading of the user's prompt at the end of the text sent (after the images, as Gemini's prompting guide advises). */
export const PROMPT_HEADING = '# 指示';

/** First line under PROMPT_HEADING when images were sent: bridges the images above and the request. */
export const PROMPT_LEAD = '以上の画像を踏まえて、次の指示どおりに画像を生成すること。';

/** Longest side of an image sent to Gemini; larger ones are scaled down (keeps the request under its size limit). */
export const MAX_UPLOAD_SIDE = 2048;
