/**
 * AIPanel — right sidebar listing the tools of features/tools/index.ts in two tabs:
 * "Custom" (pinned tools) and "All Tools". Both lists can be reordered by drag & drop.
 * Clicking a tool opens its settings sidebar, or runs it directly when it has no settings.
 */
import './ai-panel.css';
import type { Tool } from '../../shared/types/tool';
import { h, icon, setShown } from '../../shared/ui/dom';
import { createResizer } from '../../shared/ui/resizer';
import { showToast } from '../../shared/ui/toast';
import { DEFAULT_CUSTOM_TOOLS, TOOLS } from '../tools';
import { createToolSettingsSidebar } from './components/ToolSettingsSidebar';
import { enableDragSort } from './drag-sort';
import { runTool } from './tool-runner';
import {
  loadActiveTab,
  loadNames,
  type PanelTab,
  pickByNames,
  saveActiveTab,
  saveNames,
  sortByOrder,
  STORAGE_KEYS,
} from './tool-order';

const EMPTY_CUSTOM_MESSAGE =
  'カスタムツールが登録されていません。「All Tools」タブのピン留めアイコンをクリックしてツールを追加してください。';

export function createAIPanel(): HTMLElement {
  const sidebar = createToolSettingsSidebar();
  let activeTab = loadActiveTab();
  let customNames =
    loadNames(STORAGE_KEYS.customOrder) ??
    (() => {
      const defaults = DEFAULT_CUSTOM_TOOLS.filter(name => TOOLS.some(t => t.name === name));
      saveNames(STORAGE_KEYS.customOrder, defaults);
      return defaults;
    })();

  // ── Tabs ──
  const tab = (label: string) => {
    const badge = h('span', { class: 'ai-panel__tab-badge' });
    return { el: h('button', { class: 'ai-panel__tab' }, h('span', { text: label }), badge), badge };
  };
  const customTab = tab('Custom');
  const allTab = tab('All Tools');
  const allView = h('div', { class: 'ai-panel__view' });
  const customView = h('div', { class: 'ai-panel__view' });

  const switchTab = (next: PanelTab) => {
    activeTab = next;
    saveActiveTab(next);
    allTab.el.classList.toggle('ai-panel__tab--active', next === 'all');
    customTab.el.classList.toggle('ai-panel__tab--active', next === 'custom');
    setShown(allView, next === 'all', 'flex');
    setShown(customView, next === 'custom', 'flex');
  };
  allTab.el.addEventListener('click', () => switchTab('all'));
  customTab.el.addEventListener('click', () => switchTab('custom'));

  // ── Tool rows ──
  const openTool = async (tool: Tool) => {
    if (tool.canOpen && !tool.canOpen()) return;
    const renderSettings = tool.renderSettings?.bind(tool);
    if (!renderSettings) {
      await runTool(tool);
      return;
    }
    sidebar.open({
      title: tool.name,
      render: renderSettings,
      onExecute: async () => {
        if (await runTool(tool)) sidebar.close();
      },
      executeLabel: tool.executeLabel,
      executeIcon: tool.executeIcon,
    });
  };

  const setPinned = (name: string, pinned: boolean) => {
    if (pinned === customNames.includes(name)) return;
    customNames = pinned ? [...customNames, name] : customNames.filter(n => n !== name);
    saveNames(STORAGE_KEYS.customOrder, customNames);
    render();
    showToast(
      pinned ? `${name} をCustomに追加しました。` : `${name} をCustomから除外しました。`,
      pinned ? 'success' : 'info',
    );
  };

  const toolRow = (tool: Tool, mode: PanelTab) => {
    const runButton = h(
      'button',
      { class: 'ai-tool-btn' },
      tool.icon ? icon(tool.icon, 16) : h('span', { style: { width: '16px', display: 'inline-block' } }),
      h('span', { class: 'ai-tool-name', text: tool.name }),
    );
    runButton.addEventListener('click', () => {
      runButton.style.transform = 'scale(0.97)';
      setTimeout(() => (runButton.style.transform = ''), 120);
      void openTool(tool);
    });

    const pinned = customNames.includes(tool.name);
    const action =
      mode === 'all'
        ? h(
            'button',
            {
              class: `ai-tool-action-btn${pinned ? ' ai-tool-action-btn--pinned' : ''}`,
              title: pinned ? 'Customから除外' : 'Customに追加 (ピン留め)',
            },
            icon('push_pin', 16),
          )
        : h(
            'button',
            { class: 'ai-tool-action-btn ai-tool-action-btn--remove', title: 'Customから除外' },
            icon('close', 16),
          );
    action.addEventListener('click', e => {
      e.stopPropagation();
      setPinned(tool.name, mode === 'all' ? !pinned : false);
    });

    return h('div', { class: 'ai-tool-row', draggable: true, dataset: { toolName: tool.name } }, runButton, action);
  };

  function render(): void {
    const allTools = sortByOrder(TOOLS, loadNames(STORAGE_KEYS.allOrder));
    allTab.badge.textContent = String(allTools.length);
    allView.replaceChildren(...allTools.map(t => toolRow(t, 'all')));

    const customTools = pickByNames(TOOLS, customNames);
    customTab.badge.textContent = String(customTools.length);
    customView.replaceChildren(
      ...(customTools.length
        ? customTools.map(t => toolRow(t, 'custom'))
        : [
            h(
              'div',
              { class: 'ai-panel__empty' },
              h('div', { class: 'ai-panel__empty-text', text: EMPTY_CUSTOM_MESSAGE }),
            ),
          ]),
    );
  }

  enableDragSort(allView, names => saveNames(STORAGE_KEYS.allOrder, names));
  enableDragSort(customView, names => {
    customNames = names;
    saveNames(STORAGE_KEYS.customOrder, names);
  });

  const aside = h('aside', { class: 'ai-panel' });
  aside.append(
    createResizer(aside, '--right-sidebar-width', 'left', 'ai-panel__resizer'),
    h('div', { class: 'ai-panel__header' }, customTab.el, allTab.el),
    h('div', { class: 'ai-panel__views' }, allView, customView),
  );
  switchTab(activeTab);
  render();
  return aside;
}
