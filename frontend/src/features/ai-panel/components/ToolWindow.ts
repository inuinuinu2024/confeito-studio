/**
 * ToolWindow — modal window in the middle of the screen with a tool's settings and its run button
 * (docs/specs/ai-panel.md 「ツールの実行」). While it is open the app behind it is dimmed and inert;
 * ×, Esc and a click on the backdrop close it. Attached to <body> only while open.
 */
import { h, icon } from '../../../shared/ui/dom';

export interface ToolWindowContent {
  title: string;
  /** Material icon shown before the title (omitted when empty). */
  icon?: string;
  render: (body: HTMLElement) => void;
  /** Side-by-side columns (`render` appends `.tool-window__column` elements); omitted = one column. */
  columns?: number;
  /**
   * Runs the tool; calling `close` or resolving true closes the window (the run goes on after `close`).
   * The run button is disabled until then.
   */
  onExecute: (close: () => void) => Promise<boolean>;
  /** Material icon of the run button (labelled 「実行」 for every tool); null hides it. */
  executeIcon?: string | null;
  /** Focused again after the window closes (the tool's button). */
  returnFocus?: HTMLElement;
}

export interface ToolWindow {
  open(content: ToolWindowContent): void;
  close(): void;
}

const FADE_MS = 150;
const TITLE_ID = 'tool-window-title';

/** Another dialog above the window (JSON preview, prompt editor) gets Esc first. */
const hasDialogAbove = () => !!document.querySelector('dialog[open], .cs-modal-overlay--open');

export function createToolWindow(): ToolWindow {
  const titleIcon = h('span', { class: 'tool-window__icon' });
  const title = h('h2', { class: 'tool-window__title', id: TITLE_ID });
  const body = h('div', { class: 'tool-window__body' });
  const runButton = h('button', { class: 'tool-window__run' });
  const closeButton = h('button', { class: 'tool-window__close cs-window__close', title: '閉じる' }, icon('close', 20));
  const panel = h(
    'div',
    {
      class: 'tool-window',
      tabIndex: -1,
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': TITLE_ID },
    },
    h(
      'div',
      { class: 'tool-window__header' },
      h('div', { class: 'tool-window__heading' }, titleIcon, title),
      closeButton,
    ),
    body,
    h('div', { class: 'tool-window__footer' }, runButton),
  );
  const overlay = h('div', { class: 'tool-window-overlay' }, panel);

  let content: ToolWindowContent | null = null;
  let running = false;
  let pressedOnBackdrop = false;

  const renderRunButton = () => {
    if (!content) return;
    runButton.disabled = running;
    const runIcon = running || content.executeIcon === null ? null : icon(content.executeIcon || 'auto_awesome', 18);
    runButton.replaceChildren(...(runIcon ? [runIcon] : []), running ? '実行中…' : '実行');
  };

  runButton.addEventListener('click', async () => {
    const current = content;
    if (!current || running) return;
    running = true;
    renderRunButton();
    let done = false;
    try {
      done = await current.onExecute(() => {
        if (content === current) close();
      });
    } finally {
      // The window may have been closed (or reopened for another tool) while the tool ran.
      if (content === current) {
        running = false;
        renderRunButton();
        if (done) close();
      }
    }
  });
  closeButton.addEventListener('click', () => close());

  // Close on a click that starts and ends on the backdrop (dragging a slider out of the window does not count).
  overlay.addEventListener('pointerdown', e => (pressedOnBackdrop = e.target === overlay));
  overlay.addEventListener('click', e => {
    if (pressedOnBackdrop && e.target === overlay) close();
    pressedOnBackdrop = false;
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || hasDialogAbove()) return;
    e.preventDefault();
    close();
  };

  /** The app behind the window: dimmed by the backdrop and made inert (no focus, no clicks). */
  const setAppInert = (inert: boolean) => {
    const app = document.getElementById('app');
    if (app) app.inert = inert;
  };

  function open(next: ToolWindowContent): void {
    content = next;
    running = false;
    titleIcon.replaceChildren(...(next.icon ? [icon(next.icon, 20)] : [])); // empty -> hidden by CSS
    title.textContent = next.title;
    renderRunButton();
    const columns = next.columns && next.columns > 1 ? next.columns : 0;
    panel.classList.toggle('tool-window--columns', columns > 0);
    body.classList.toggle('tool-window__body--columns', columns > 0);
    panel.style.setProperty('--tool-window-columns', String(columns || 1));
    body.replaceChildren();
    next.render(body);
    body.scrollTop = 0;

    overlay.classList.remove('tool-window-overlay--open');
    document.body.appendChild(overlay);
    void overlay.offsetHeight; // reflow so the fade-in transition runs
    overlay.classList.add('tool-window-overlay--open');
    setAppInert(true);
    document.addEventListener('keydown', onKeyDown);
    panel.focus();
  }

  function close(): void {
    if (!content) return;
    const returnFocus = content.returnFocus;
    content = null;
    document.removeEventListener('keydown', onKeyDown);
    setAppInert(false);
    overlay.classList.remove('tool-window-overlay--open');
    setTimeout(() => {
      if (!content) overlay.remove();
    }, FADE_MS);
    returnFocus?.focus();
  }

  return { open, close };
}
