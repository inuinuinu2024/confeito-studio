/**
 * Every tool shown in the AI panel. The order here is the default order of the
 * "All Tools" tab (users can reorder; the order is stored in localStorage).
 *
 * To add a tool: create features/tools/<id>.ts (or <id>/<id>.ts for a large one) implementing `Tool`
 * (shared/types/tool.ts), add it below, and document it in docs/specs/tools/.
 */
import type { Tool } from '../../shared/types/tool';
import { ImageLoaderTool } from './image-loader';
import { NanoBananaProTool } from './nano-banana-pro/nano-banana-pro';
import { PanelMergeTool } from './panel-merge';
import { PanelSplitterTool } from './panel-splitter';
import { RemoveBackgroundTool } from './remove-background';

export const TOOLS: readonly Tool[] = [
  new ImageLoaderTool(),
  new PanelSplitterTool(),
  new NanoBananaProTool(),
  new RemoveBackgroundTool(),
  new PanelMergeTool(),
];

/** Tools pinned to the "Custom" tab on first start. */
export const DEFAULT_CUSTOM_TOOLS = ['Nano Banana Pro'];
