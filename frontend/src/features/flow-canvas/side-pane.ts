/**
 * A side pane of the Workspace (docs/specs/flow-canvas.md 「3 枚構成」): 元ページ (left, the page before it was split)
 * or コマ結合後 (right, the merged page). Both look like a panel row of the flow (images in cells with their bands)
 * but take the whole pane: they are not split into rows. Open, the pane shows one image (its 「最終」); widened, its
 * label on the left and the cells FlowCanvas renders (`setRow`: the 原画 and what was made from it), each as high as
 * the pane, then the tools.
 * A round button with a triangle on the boundary with the flow collapses the pane (it disappears; the button stays
 * on the boundary) and opens it again; its width is dragged at that boundary. The pane opens in two stages: a second
 * button below it widens the open pane over the flow, up to the other pane, and ◀ brings it back; ▶▶ / ◀◀ go
 * straight from collapsed to wide and back. All is kept in the settings (`flowCanvas_<side>Open` / `Wide` / `Width`).
 */
import { fetchArchiveKey } from '../../shared/api/archives';
import type { ToolSettings } from '../../shared/state/tool-settings';
import type { FlowImage } from '../../shared/types/flow';
import { h, icon, setShown } from '../../shared/ui/dom';
import { createResizer } from '../../shared/ui/resizer';

export interface SidePane {
  el: HTMLElement;
  /**
   * Shows `image` in the open pane's cell (null: the empty text), or hides the pane (undefined). `band`: the name in
   * the cell's band (「原画」 by default); `size`: the image whose size the label shows.
   */
  show(image: FlowImage | null | undefined, opts?: { band?: string; size?: FlowImage }): void;
  /** The cells of the widened pane, left to right (the tools follow them); `extra` goes under the label (‹ ›). */
  setRow(cells: readonly HTMLElement[], extra?: HTMLElement | null): void;
  /** Marks the image shown as selected when its key is in `keys`. */
  select(keys: readonly string[]): void;
  /** Back to the open width when widened (the other pane was widened). */
  narrow(): void;
  /**
   * The whole Workspace, shown as widened, without the buttons on the boundary (a page not split yet, with nothing else
   * in the flow). The saved open / wide state is kept for when it is a side pane again.
   */
  setFull(full: boolean): void;
  readonly wide: boolean;
}

const sizeText = (image: FlowImage) => (image.width && image.height ? `${image.width} × ${image.height}` : '');

export function createSidePane(opts: {
  side: 'left' | 'right';
  title: string;
  /** Shown when there is nothing to show yet. */
  empty: string;
  settings: ToolSettings;
  onOpen: (image: FlowImage, title: string) => void;
  /** Right of the row, shown only while widened: the tool buttons. */
  tools: HTMLElement;
  /** The pane was widened (the other one goes back to its open width). */
  onWiden: () => void;
}): SidePane {
  const { side, title, settings } = opts;
  const cssVar = `--flow-${side}-width`;
  const savedWidth = settings.get(`${side}Width`, '');
  if (savedWidth) document.documentElement.style.setProperty(cssVar, `${savedWidth}px`);

  const sizeLabel = h('span', { class: 'flow-pane__size' });
  const extraSlot = h('div', { class: 'flow-pane__row-extra' });
  // ◀ / ▶ in a circle on the boundary: points the way the pane moves (closing towards the window edge).
  const edgeIcon = icon('arrow_left', 20);
  const edgeButton = h('button', { class: 'flow-pane__edge' }, edgeIcon);
  // The second stage, below ◀ while the pane is open (not wide yet): points the way the pane grows.
  const wideButton = h(
    'button',
    { class: 'flow-pane__wide', title: `${title}を広げる` },
    icon(side === 'left' ? 'arrow_right' : 'arrow_left', 20),
  );
  // ▶▶ while collapsed (straight to wide) / ◀◀ while wide (straight to collapsed): two triangles, like ◀ / ▶.
  const jumpIcons = [icon('arrow_right', 20), icon('arrow_right', 20)];
  const jumpButton = h('button', { class: 'flow-pane__jump' }, ...jumpIcons);
  const mainImage = h('img', { class: 'flow-pane__img flow-pane__cell-img', alt: title, draggable: false });
  // The cell: the same band as the 原画 of a panel row, the whole image (its own classes: it is not a cell of the flow).
  const bandName = h('span', { class: 'flow-cell__origin-name', text: '原画' });
  const main = h(
    'button',
    { class: 'flow-pane__cell', title: '拡大表示' },
    h('span', { class: 'flow-cell__origin flow-cell__origin--source' }, bandName),
    h('span', { class: 'flow-pane__cell-thumb' }, mainImage),
  );
  const emptyText = h('div', { class: 'flow-pane__empty', text: opts.empty });
  // Widened: the cells of the row side by side (scrolling sideways when they do not fit), then the tools.
  const history = h('div', { class: 'flow-pane__history' });
  const label = h(
    'div',
    { class: 'flow-pane__row-label' },
    h('span', { class: 'flow-pane__title', text: title }),
    sizeLabel,
    extraSlot,
  );
  const content = h(
    'div',
    { class: 'flow-pane__content' },
    h('div', { class: 'flow-pane__row' }, label, main, emptyText, history),
  );
  const el = h(
    'aside',
    { class: `flow-pane flow-pane--${side}` },
    content,
    h('div', { class: 'flow-pane__edges' }, edgeButton, wideButton, jumpButton),
  );
  el.append(
    createResizer(el, cssVar, side === 'left' ? 'right' : 'left', 'flow-pane__resizer', width => {
      settings.set(`${side}Width`, String(Math.round(width)));
      void settings.save();
    }),
  );

  let open = settings.get(`${side}Open`, 'true') !== 'false';
  let wide = settings.get(`${side}Wide`, 'false') === 'true';
  let full = false;
  const applyOpen = () => {
    el.classList.toggle('flow-pane--full', full);
    el.classList.toggle('flow-pane--collapsed', !open && !full);
    el.classList.toggle('flow-pane--wide', full || (open && wide));
    const towardsLeft = side === 'left' ? open : !open;
    edgeIcon.textContent = towardsLeft ? 'arrow_left' : 'arrow_right';
    edgeButton.title = !open ? `${title}を開く` : wide ? `${title}を元の幅に戻す` : `${title}を畳む`;
    setShown(wideButton, open && !wide, 'flex');
    setShown(jumpButton, !open || wide, 'flex');
    // Towards the flow while collapsed (opening all the way), towards the window edge while wide (closing).
    const jumpLeft = side === 'left' ? open : !open;
    for (const i of jumpIcons) i.textContent = jumpLeft ? 'arrow_left' : 'arrow_right';
    jumpButton.title = open ? `${title}を畳む` : `${title}を広げて開く`;
  };
  const save = (key: string, value: boolean) => {
    settings.set(`${side}${key}`, String(value));
    void settings.save();
  };
  const setOpen = (value: boolean) => {
    open = value;
    applyOpen();
    save('Open', value);
  };
  const setWide = (value: boolean) => {
    wide = value;
    applyOpen();
    save('Wide', value);
    if (value) opts.onWiden();
  };
  /** ▶▶ / ◀◀: collapsed ↔ wide in one go (collapsing also leaves the wide stage, as ◀ then ◀ would). */
  const setOpenWide = (value: boolean) => {
    open = value;
    settings.set(`${side}Open`, String(value));
    setWide(value);
  };
  // ◀ of a wide pane goes back one stage (to the open width), not all the way.
  edgeButton.addEventListener('click', () => (open && wide ? setWide(false) : setOpen(!open)));
  wideButton.addEventListener('click', () => setWide(true));
  jumpButton.addEventListener('click', () => setOpenWide(!open));
  applyOpen();

  let image: FlowImage | null = null;
  let shownUrl: { key: string; url: string } | null = null;
  let request = 0;

  main.addEventListener('click', () => {
    if (image) opts.onOpen(image, title);
  });

  return {
    el,
    show(next, shown) {
      setShown(el, next !== undefined, 'flex');
      image = next ?? null;
      // Without an image: the empty text instead of the cell (the CSS swaps them).
      el.classList.toggle('flow-pane--empty', !image);
      bandName.textContent = shown?.band ?? '原画';
      const sized = shown?.size ?? image;
      sizeLabel.textContent = sized ? sizeText(sized) : '';
      if (!image || shownUrl?.key === image.key) return;
      const key = image.key;
      const mine = ++request;
      mainImage.removeAttribute('src');
      void fetchArchiveKey(key).then(blob => {
        if (mine !== request || !blob) return;
        if (shownUrl) URL.revokeObjectURL(shownUrl.url);
        shownUrl = { key, url: URL.createObjectURL(blob) };
        mainImage.src = shownUrl.url;
        mainImage.dataset.key = key;
      });
    },
    setRow(cells, extra) {
      history.replaceChildren(...cells, opts.tools);
      extraSlot.replaceChildren(...(extra ? [extra] : []));
    },
    select(keys) {
      main.classList.toggle('flow-pane__cell--selected', !!image && keys.includes(image.key));
    },
    narrow() {
      if (open && wide) setWide(false);
    },
    setFull(value) {
      full = value;
      applyOpen();
    },
    get wide() {
      return open && wide;
    },
  };
}
