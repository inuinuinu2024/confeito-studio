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

/** `[xmin, ymin, xmax, ymax]` in pixels of the page (Pillow / PASCAL VOC, like panels.json `pixel_box`). */
export type PixelBox = [number, number, number, number];

/**
 * Pastes the panels of `<targetFolder>/panels.json` back into one image. `overrides` replaces panels
 * (panel file name -> archive key of the image to paste instead, resized to the panel); `boxes` places the
 * panels cut again (コマ切り直し) at their own box (panel file name -> box), resized to it.
 */
export function mergePanels(
  targetFolder: string,
  overrides: Record<string, string> = {},
  boxes: Record<string, PixelBox> = {},
): Promise<MergePanelsResult> {
  const json = (value: object) => (Object.keys(value).length ? JSON.stringify(value) : undefined);
  return postForm(
    '/image/merge-panels',
    formData({ target_folder: targetFolder, overrides: json(overrides), boxes: json(boxes) }),
  );
}

export interface RecropPanelResult {
  status: 'success';
  /** Result folder key "<archive>/<stamp>_コマ切り直し". */
  folder: string;
  /** Key of the new panel image (same file name as the panel). */
  key: string;
  pixel_box: PixelBox;
  width: number;
  height: number;
}

/** Cuts panel `panelKey` (an output of a コマ分割) again from the split page with `box` (page pixels). */
export function recropPanel(panelKey: string, box: PixelBox): Promise<RecropPanelResult> {
  return postForm('/image/recrop-panel', formData({ panel_key: panelKey, box: JSON.stringify(box) }));
}
