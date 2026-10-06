/**
 * The processing flow of one archive (GET /api/archives/{name}/flow, backend services/flow_service.py),
 * drawn by the Normal mode canvas (features/flow-canvas/, docs/specs/flow-canvas.md).
 */

/** One image: an imported page at the archive root, or an output of a tool run. */
export interface FlowImage {
  /** "<archive>/<relative path>" */
  key: string;
  name: string;
  /** Pixel size; null when the backend could not read it. */
  width: number | null;
  height: number | null;
}

/** One tool run: a result folder and its info.json. */
export interface FlowRun {
  /** Result folder key "<archive>/<YYYYMMDD_HHMMSS>_<tool>". */
  folder: string;
  tool: string;
  /** "YYYY-MM-DD HH:MM:SS" */
  created_at: string;
  /** Input image key (コマ結合: the コマ分割 folder), or null (no input, e.g. a 原画 added from a file). */
  source: string | null;
  /** Every input image when there are several (コマ結合); [] otherwise. */
  sources: string[];
  settings: Record<string, unknown>;
  /** Images directly in the result folder, in the order info.json lists them. */
  outputs: FlowImage[];
}

export interface FlowData {
  archive: string;
  roots: FlowImage[];
  /** Oldest first. */
  runs: FlowRun[];
  /** Shown run (folder key) of each stack id the user switched; other stacks show their newest run. */
  selection: Record<string, string>;
  /** Image marked for each panel (panel image key -> image key): what コマ結合 pastes for that panel. */
  merge: Record<string, string>;
}
