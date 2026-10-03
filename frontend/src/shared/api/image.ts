/** /api/image — background removal and manga panel split/merge (backend/src/app/routers/image.py). */
import { formData, postForm, request } from './http';

export interface RemoveBackgroundOptions {
  alphaMatting: string;
  foregroundThreshold: string;
  backgroundThreshold: string;
  erodeSize: string;
}

/** Returns a PNG with a transparent background (rembg, runs locally). */
export async function removeBackground(
  image: Blob,
  opts: RemoveBackgroundOptions,
  signal?: AbortSignal,
): Promise<Blob> {
  const form = formData({
    image: [image, 'image.png'],
    alpha_matting: opts.alphaMatting,
    alpha_matting_foreground_threshold: opts.foregroundThreshold,
    alpha_matting_background_threshold: opts.backgroundThreshold,
    alpha_matting_erode_size: opts.erodeSize,
  });
  return (await request('/image/remove-bg', { method: 'POST', body: form, signal })).blob();
}

export interface PanelSplitOptions {
  readingOrder: string;
  padding: number;
  model: string;
  thinkingLevel: string;
}

/** One entry of panels.json["panels"]. */
export interface PanelRecord {
  panel_number: number;
  filename: string;
  box_2d: [number, number, number, number];
  pixel_box: [number, number, number, number];
  xywh: [number, number, number, number];
  width: number;
  height: number;
}

export interface SplitPanelsResult {
  status: 'success';
  /** Result folder key: "<root>/<stamp>_コマ分割" or a new archive "<stamp>_コマ分割". */
  folder: string;
  auto_select_key: string;
  panels_count: number;
  panels: PanelRecord[];
  original_filename: string;
  image_width: number;
  image_height: number;
  model: string;
  thinking_level: string;
}

/**
 * Detects panels with Gemini and saves 01.png, 02.png, ... + panels.json + info.json into the
 * top level of `targetFolder` (a new archive when null). `sourceKey` is recorded in info.json.
 */
export function splitPanels(
  image: Blob,
  originalFilename: string,
  targetFolder: string | null,
  sourceKey: string | null,
  opts: PanelSplitOptions,
): Promise<SplitPanelsResult> {
  return postForm(
    '/image/split-panels',
    formData({
      image: [image, originalFilename],
      reading_order: opts.readingOrder,
      padding: opts.padding,
      original_filename: originalFilename,
      model_name: opts.model,
      thinking_level: opts.thinkingLevel,
      target_folder: targetFolder,
      source_key: sourceKey,
    }),
  );
}

export interface SplitPanelsPreview {
  api_endpoint: string;
  request_body: unknown;
}

/** The exact Gemini request splitPanels would send (image replaced by a placeholder). */
export function previewSplitPanels(opts: Omit<PanelSplitOptions, 'padding'>): Promise<SplitPanelsPreview> {
  return postForm(
    '/image/split-panels/preview',
    formData({
      reading_order: opts.readingOrder,
      model_name: opts.model,
      thinking_level: opts.thinkingLevel,
    }),
  );
}

export interface MergePanelsResult {
  status: 'success';
  /** Result folder key: "<root of the target>/<stamp>_コマ結合". */
  folder: string;
  filename: string;
  auto_select_key: string;
}

/** Pastes the panels of `<targetFolder>/panels.json` back into one image. */
export function mergePanels(targetFolder: string): Promise<MergePanelsResult> {
  return postForm('/image/merge-panels', formData({ target_folder: targetFolder }));
}
