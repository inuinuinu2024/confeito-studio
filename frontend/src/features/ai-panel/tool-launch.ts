/**
 * Opening a tool and running it with its saved settings, the same from the TOOLS list (AIPanel.ts) and from the tool
 * buttons at the right end of the Workspace's panel rows (docs/specs/ai-panel.md, flow-canvas.md 「コマの行のツール」).
 * The settings are read again (and `Tool.beforeOpen` runs) first, so the window shows the saved values.
 */
import { loadSettings } from '../../shared/state/tool-settings';
import type { Tool } from '../../shared/types/tool';
import { createToolWindow, type ToolWindow } from './components/ToolWindow';
import { runTool, warnIfToolRunning } from './tool-runner';

let toolWindow: ToolWindow | null = null;

/** The tool's settings in the tool window (a tool without settings runs at once). */
export async function openTool(tool: Tool, returnFocus?: HTMLElement): Promise<void> {
  const renderSettings = tool.renderSettings?.bind(tool);
  if (!renderSettings) {
    await runTool(tool);
    return;
  }
  if (warnIfToolRunning(tool.name)) return;
  await loadSettings();
  await tool.beforeOpen?.();
  toolWindow ??= createToolWindow();
  toolWindow.open({
    title: tool.name,
    icon: tool.icon,
    render: renderSettings,
    columns: tool.windowColumns,
    // Closes once the tool has checked its inputs; stays open when one is missing.
    onExecute: close => runTool(tool, close),
    executeIcon: tool.executeIcon,
    returnFocus,
  });
}

/** ▶: runs with the saved settings, preparing the tool as if its window opened. */
export async function playTool(tool: Tool): Promise<void> {
  if (warnIfToolRunning(tool.name)) return;
  await loadSettings();
  await tool.beforeOpen?.();
  await runTool(tool);
}
