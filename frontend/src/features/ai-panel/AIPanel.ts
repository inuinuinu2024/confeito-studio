/**
 * AIPanel — right sidebar listing the tools of features/tools/index.ts.
 * The list can be reordered by drag & drop.
 * Clicking a tool opens its settings in the tool window (a modal in the middle of the screen),
 * or runs it directly when it has no settings. The settings are read again (and `Tool.beforeOpen` runs)
 * before the window opens, so it shows the saved values (docs/specs/app-shell.md 「設定の保存」).
 * The ▶ button at the right end of a row runs the tool with those settings without the window;
 * while that tool runs it shows ⏸, which stops the run (docs/specs/ai-panel.md).
 */
import './ai-panel.css';
import type { Tool } from '../../shared/types/tool';
import { on } from '../../shared/events';
import { h, icon } from '../../shared/ui/dom';
import { loadSettings } from '../../shared/state/tool-settings';
import { createResizer } from '../../shared/ui/resizer';
import { TOOLS } from '../tools';
import { enableDragSort } from '../../shared/ui/drag-sort';
import { createToolWindow } from './components/ToolWindow';
import { runTool, stopTool, warnIfToolRunning } from './tool-runner';
import { loadToolOrder, saveToolOrder, sortByOrder } from './tool-order';

export function createAIPanel(): HTMLElement {
  const toolWindow = createToolWindow();

  const openTool = async (tool: Tool, button: HTMLElement) => {
    const renderSettings = tool.renderSettings?.bind(tool);
    if (!renderSettings) {
      await runTool(tool);
      return;
    }
    if (warnIfToolRunning(tool.name)) return;
    await loadSettings();
    await tool.beforeOpen?.();
    toolWindow.open({
      title: tool.name,
      icon: tool.icon,
      render: renderSettings,
      columns: tool.windowColumns,
      // Closes once the tool has checked its inputs; stays open when one is missing.
      onExecute: close => runTool(tool, close),
      executeIcon: tool.executeIcon,
      returnFocus: button,
    });
  };

  /** ▶: runs with the saved settings, preparing the tool as if its window opened. */
  const play = async (tool: Tool) => {
    if (warnIfToolRunning(tool.name)) return;
    await loadSettings();
    await tool.beforeOpen?.();
    await runTool(tool);
  };

  const toolRow = (tool: Tool) => {
    const runButton = h(
      'button',
      { class: 'ai-tool-btn' },
      tool.icon ? icon(tool.icon, 16) : h('span', { style: { width: '16px', display: 'inline-block' } }),
      h('span', { class: 'ai-tool-name', text: tool.name }),
    );
    runButton.addEventListener('click', () => {
      runButton.style.transform = 'scale(0.97)';
      setTimeout(() => (runButton.style.transform = ''), 120);
      void openTool(tool, runButton);
    });
    const playButton = h('button', { class: 'ai-tool-play' });
    const showPlay = (running: boolean) => {
      playButton.replaceChildren(icon(running ? 'pause' : 'play_arrow', 18));
      playButton.title = running ? '実行を停止' : '設定済みの内容で実行';
      row.classList.toggle('ai-tool-row--running', running);
    };
    playButton.addEventListener('click', () => {
      if (row.classList.contains('ai-tool-row--running')) stopTool();
      else void play(tool);
    });
    const row = h(
      'div',
      { class: 'ai-tool-row', draggable: true, dataset: { toolName: tool.name } },
      runButton,
      playButton,
    );
    on('tool:start', ({ toolName }) => showPlay(toolName === tool.name));
    on('tool:end', () => showPlay(false));
    showPlay(false);
    return row;
  };

  const list = h('div', { class: 'ai-panel__list' });
  list.replaceChildren(...sortByOrder(TOOLS, loadToolOrder()).map(toolRow));
  enableDragSort(list, '.ai-tool-row', rows => saveToolOrder(rows.map(row => row.dataset.toolName ?? '')));
  // Dimmed while a tool runs (except the running tool's ⏸); a click then only warns (tool-runner.ts).
  on('tool:start', () => list.classList.add('ai-panel__list--busy'));
  on('tool:end', () => list.classList.remove('ai-panel__list--busy'));

  const aside = h('aside', { class: 'ai-panel' });
  aside.append(
    createResizer(aside, '--right-sidebar-width', 'left', 'ai-panel__resizer'),
    h('div', { class: 'ai-panel__header' }, h('span', { class: 'ai-panel__title', text: 'TOOLS' })),
    list,
  );
  return aside;
}
