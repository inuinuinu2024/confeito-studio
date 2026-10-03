/**
 * AIPanel — right sidebar listing the tools of features/tools/index.ts.
 * The list can be reordered by drag & drop.
 * Clicking a tool opens its settings in the tool window (a modal in the middle of the screen),
 * or runs it directly when it has no settings.
 */
import './ai-panel.css';
import type { Tool } from '../../shared/types/tool';
import { h, icon } from '../../shared/ui/dom';
import { createResizer } from '../../shared/ui/resizer';
import { TOOLS } from '../tools';
import { enableDragSort } from '../../shared/ui/drag-sort';
import { createToolWindow } from './components/ToolWindow';
import { runTool } from './tool-runner';
import { loadToolOrder, saveToolOrder, sortByOrder } from './tool-order';

export function createAIPanel(): HTMLElement {
  const toolWindow = createToolWindow();

  const openTool = async (tool: Tool, button: HTMLElement) => {
    const renderSettings = tool.renderSettings?.bind(tool);
    if (!renderSettings) {
      await runTool(tool);
      return;
    }
    toolWindow.open({
      title: tool.name,
      icon: tool.icon,
      render: renderSettings,
      columns: tool.windowColumns,
      onExecute: () => runTool(tool), // closes on success; stays open on a warning or an error
      executeIcon: tool.executeIcon,
      returnFocus: button,
    });
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
    return h('div', { class: 'ai-tool-row', draggable: true, dataset: { toolName: tool.name } }, runButton);
  };

  const list = h('div', { class: 'ai-panel__list' });
  list.replaceChildren(...sortByOrder(TOOLS, loadToolOrder()).map(toolRow));
  enableDragSort(list, '.ai-tool-row', rows => saveToolOrder(rows.map(row => row.dataset.toolName ?? '')));

  const aside = h('aside', { class: 'ai-panel' });
  aside.append(
    createResizer(aside, '--right-sidebar-width', 'left', 'ai-panel__resizer'),
    h('div', { class: 'ai-panel__header' }, h('span', { class: 'ai-panel__title', text: 'TOOLS' })),
    list,
  );
  return aside;
}
