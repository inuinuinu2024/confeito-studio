/**
 * Slide-in sidebar (from the right, below the top bar) with a tool's settings and its run button.
 * The element is attached to <body> while open and removed 300ms after closing.
 */
import { h, icon } from '../../../shared/ui/dom';

export interface SidebarContent {
  title: string;
  render: (body: HTMLElement) => void;
  onExecute: () => void;
  executeLabel?: string;
  /** Material icon of the run button; null hides it. */
  executeIcon?: string | null;
}

export interface ToolSettingsSidebar {
  open(content: SidebarContent): void;
  close(): void;
}

const CLOSE_ANIMATION_MS = 300;

export function createToolSettingsSidebar(): ToolSettingsSidebar {
  const title = h('h2', { class: 'tool-settings-sidebar__title' });
  const body = h('div', { class: 'tool-settings-sidebar__body' });
  const runButton = h('button', { class: 'tool-settings-sidebar__run' });
  let onExecute: (() => void) | null = null;
  let isOpen = false;

  runButton.addEventListener('click', () => onExecute?.());

  const sidebar = h(
    'div',
    { class: 'tool-settings-sidebar' },
    h(
      'div',
      { class: 'tool-settings-sidebar__header' },
      title,
      h('button', { class: 'tool-settings-sidebar__close', onclick: () => close() }, icon('close', 20)),
    ),
    body,
    h('div', { class: 'tool-settings-sidebar__footer' }, runButton),
  );

  function open(content: SidebarContent): void {
    title.textContent = content.title;
    onExecute = content.onExecute;
    runButton.replaceChildren(
      ...(content.executeIcon === null ? [] : [icon(content.executeIcon || 'auto_awesome', 18)]),
      content.executeLabel || '生成する',
    );
    body.replaceChildren();
    content.render(body);

    sidebar.classList.remove('tool-settings-sidebar--open');
    document.body.appendChild(sidebar);
    void sidebar.offsetHeight; // reflow so the slide-in transition runs
    sidebar.classList.add('tool-settings-sidebar--open');
    isOpen = true;
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    sidebar.classList.remove('tool-settings-sidebar--open');
    setTimeout(() => {
      if (!isOpen) sidebar.remove();
    }, CLOSE_ANIMATION_MS);
  }

  return { open, close };
}
