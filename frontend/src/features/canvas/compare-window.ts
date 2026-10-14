/**
 * The comparison window (docs/specs/flow-canvas.md 「原画との比較」): an image generated from a 原画, opened from the
 * flow canvas, compared in the Parallel / Slider / Overlay view (comparison-view.ts) with the first image of its flow
 * or, chosen in the header, another image generated in the same step.
 * It opens in Parallel (L = the chosen image, R = the generated one); the header switches to Slider (the two stacked
 * with a divider) and Overlay (U / T) and back.
 * It is a 別ウィンドウ (shared/ui/window.ts): ×, Esc and a click outside the window close it; nothing else changes.
 */
import { on } from '../../shared/events';
import { loadBgColor } from '../../shared/state/canvas-background';
import type { FlowImage } from '../../shared/types/flow';
import { h } from '../../shared/ui/dom';
import { select } from '../../shared/ui/form';
import { openWindow } from '../../shared/ui/window';
import { type CompareMode, createComparisonView } from './comparison-view';

/** An image the generated one can be compared with, as the header lists it ("原画（01.png）"). */
export interface CompareTarget {
  label: string;
  image: FlowImage;
}

export interface CompareWindowOptions {
  /** Window title ("<tool> — <file name>"). */
  title: string;
  /** What to compare with (L / U), the first one chosen when the window opens: the 原画, then other generated images. */
  targets: readonly CompareTarget[];
  /** The generated image (R / T). */
  processed: FlowImage;
}

const MODES: { mode: CompareMode; label: string }[] = [
  { mode: 'parallel', label: 'Parallel' },
  { mode: 'slider', label: 'Slider' },
  { mode: 'overlay', label: 'Overlay' },
];

export function openCompareWindow(opts: CompareWindowOptions): void {
  const view = createComparisonView({
    messages: {
      left: '比べる画像を表示できません',
      right: '処理後の画像を表示できません',
      overlay: '重ね合わせる画像を表示できません',
    },
  });
  view.setBgColor(loadBgColor());
  // The background colour can be changed while the window is open (Ctrl+B).
  const stopBgColor = on('canvas:bg-color', ({ color }) => view.setBgColor(color));

  let mode: CompareMode = 'parallel';
  let target = opts.targets[0]?.image ?? null;
  const show = () => view.show(mode, [target, opts.processed]);

  const targetSelect = select(
    opts.targets.map((t, i) => ({ value: String(i), label: t.label })),
    '0',
    value => {
      target = opts.targets[Number(value)]?.image ?? null;
      show();
    },
  );
  targetSelect.classList.add('compare-window__target');
  targetSelect.title = '比べる画像';

  const modeButtons = MODES.map(m =>
    h('button', {
      class: 'compare-window__mode',
      type: 'button',
      title: `${m.label} で比較`,
      text: m.label,
      dataset: { mode: m.mode },
      onclick: () => setMode(m.mode),
    }),
  );
  const setMode = (next: CompareMode) => {
    for (const b of modeButtons) b.classList.toggle('compare-window__mode--active', b.dataset.mode === next);
    if (view.mode() === next) return;
    mode = next;
    show();
  };

  const win = openWindow({
    title: opts.title,
    className: 'compare-window',
    headerTools: [
      targetSelect,
      h(
        'div',
        { class: 'compare-window__modes', attrs: { role: 'group', 'aria-label': '比較の表示' } },
        ...modeButtons,
      ),
    ],
    onClose: () => {
      stopBgColor();
      view.destroy();
    },
  });
  // Images dropped on the window are not imported (and do not open in the browser).
  view.el.addEventListener('dragover', e => e.preventDefault());
  view.el.addEventListener('drop', e => e.preventDefault());
  win.body.append(view.el);
  setMode('parallel');
}
