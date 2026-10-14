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
import { h } from '../../shared/ui/dom';
import { createResizer } from '../../shared/ui/resizer';
import { TOOLS } from '../tools';
import { enableDragSort } from '../../shared/ui/drag-sort';
import { createToolButton } from './components/ToolButton';
import { openTool, playTool } from './tool-launch';
import { loadToolOrder, saveToolOrder, sortByOrder } from './tool-order';

export function createAIPanel(): HTMLElement {
  const toolRow = (tool: Tool) => {
    const button = createToolButton(tool, {
      open: el => void openTool(tool, el),
      play: () => void playTool(tool),
    });
    button.el.draggable = true;
    on('tool:start', ({ toolName }) => button.setRunning(toolName === tool.name));
    on('tool:end', () => button.setRunning(false));
    return button.el;
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
