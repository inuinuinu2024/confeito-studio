/**
 * ToolButton — a tool's button as in the TOOLS list: its icon and name (opens the tool window) and ▶ at the right end
 * (runs with the saved settings; ⏸ while that tool runs, which stops it). Also used at the right end of the
 * Workspace's panel rows. The caller tells it when its tool starts / stops running (`setRunning`).
 */
import type { Tool } from '../../../shared/types/tool';
import { h, icon } from '../../../shared/ui/dom';
import { stopTool } from '../tool-runner';

export interface ToolButton {
  /** `.ai-tool-row`: the button and its ▶. */
  el: HTMLElement;
  setRunning(running: boolean): void;
}

/** `label`: the button's text when it is not the tool's name (「全コマに背景除去」). */
export function createToolButton(
  tool: Tool,
  actions: { open(button: HTMLElement): void; play(): void },
  label: string = tool.name,
): ToolButton {
  const runButton = h(
    'button',
    { class: 'ai-tool-btn' },
    tool.icon ? icon(tool.icon, 16) : h('span', { class: 'ai-tool-icon-space' }),
    h('span', { class: 'ai-tool-name', text: label }),
  );
  runButton.addEventListener('click', () => actions.open(runButton));
  const playButton = h('button', { class: 'ai-tool-play' });
  const el = h('div', { class: 'ai-tool-row', dataset: { toolName: tool.name } }, runButton, playButton);
  const setRunning = (running: boolean) => {
    playButton.replaceChildren(icon(running ? 'pause' : 'play_arrow', 18));
    playButton.title = running ? '停止' : '実行';
    el.classList.toggle('ai-tool-row--running', running);
  };
  playButton.addEventListener('click', () => {
    if (el.classList.contains('ai-tool-row--running')) stopTool();
    else actions.play();
  });
  setRunning(false);
  return { el, setRunning };
}
