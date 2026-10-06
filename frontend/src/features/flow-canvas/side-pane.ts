/**
 * A side pane of the Workspace (docs/specs/flow-canvas.md 「3 枚構成」): 元ページ (left, the page before it was split)
 * or コマ結合後 (right, the merged pages). One image large, fitted to the pane (a click opens the viewer); with
 * several images (merges) the others are small below it and a click shows one large.
 * A round button with a triangle on the boundary with the flow collapses the pane (it disappears; the button stays
 * on the boundary) and opens it again; its width is dragged at that boundary. Both are kept in the settings (`flowCanvas_<side>Open` / `Width`).
 */
import { fetchArchiveKey } from '../../shared/api/archives';
import type { ToolSettings } from '../../shared/state/tool-settings';
import type { FlowImage } from '../../shared/types/flow';
import { h, icon, setShown } from '../../shared/ui/dom';
import { createResizer } from '../../shared/ui/resizer';
import { thumbnailUrl } from './thumbnails';

export interface SidePane {
  el: HTMLElement;
  /** Shows `images` (the first one large unless another was clicked), or hides the pane (null). */
  show(images: readonly FlowImage[] | null): void;
}

const sizeText = (image: FlowImage) => (image.width && image.height ? `${image.width} × ${image.height}` : '');

export function createSidePane(opts: {
  side: 'left' | 'right';
  title: string;
  /** Shown when there is nothing to show yet. */
  empty: string;
  settings: ToolSettings;
  onOpen: (image: FlowImage, title: string) => void;
}): SidePane {
  const { side, title, settings } = opts;
  const cssVar = `--flow-${side}-width`;
  const savedWidth = settings.get(`${side}Width`, '');
  if (savedWidth) document.documentElement.style.setProperty(cssVar, `${savedWidth}px`);

  const sizeLabel = h('span', { class: 'flow-pane__size' });
  // ◀ / ▶ in a circle on the boundary: points the way the pane moves (closing towards the window edge).
  const edgeIcon = icon('arrow_left', 20);
  const edgeButton = h('button', { class: 'flow-pane__edge' }, edgeIcon);
  const mainImage = h('img', { class: 'flow-pane__img', alt: title, draggable: false });
  const main = h('button', { class: 'flow-pane__main', title: 'クリックで拡大表示' }, mainImage);
  const emptyText = h('div', { class: 'flow-pane__empty', text: opts.empty });
  const list = h('div', { class: 'flow-pane__list' });
  const content = h(
    'div',
    { class: 'flow-pane__content' },
    h('div', { class: 'flow-pane__head' }, h('span', { class: 'flow-pane__title', text: title }), sizeLabel),
    h('div', { class: 'flow-pane__body' }, main, emptyText),
    list,
  );
  const el = h('aside', { class: `flow-pane flow-pane--${side}` }, content, edgeButton);
  el.append(
    createResizer(el, cssVar, side === 'left' ? 'right' : 'left', 'flow-pane__resizer', width => {
      settings.set(`${side}Width`, String(Math.round(width)));
      void settings.save();
    }),
  );

  let open = settings.get(`${side}Open`, 'true') !== 'false';
  const applyOpen = () => {
    el.classList.toggle('flow-pane--collapsed', !open);
    const towardsLeft = side === 'left' ? open : !open;
    edgeIcon.textContent = towardsLeft ? 'arrow_left' : 'arrow_right';
    edgeButton.title = open ? `${title}を畳む` : `${title}を開く`;
  };
  const setOpen = (value: boolean) => {
    open = value;
    applyOpen();
    settings.set(`${side}Open`, String(value));
    void settings.save();
  };
  edgeButton.addEventListener('click', () => setOpen(!open));
  applyOpen();

  let images: readonly FlowImage[] = [];
  /** The image shown large (null: the first one). */
  let chosen: string | null = null;
  let shownUrl: { key: string; url: string } | null = null;
  let request = 0;

  const current = () => images.find(i => i.key === chosen) ?? images[0] ?? null;

  const render = () => {
    const image = current();
    setShown(main, !!image, 'flex');
    setShown(emptyText, !image);
    sizeLabel.textContent = image ? sizeText(image) : '';
    if (image && shownUrl?.key !== image.key) {
      const mine = ++request;
      mainImage.removeAttribute('src');
      void fetchArchiveKey(image.key).then(blob => {
        if (mine !== request || !blob) return;
        if (shownUrl) URL.revokeObjectURL(shownUrl.url);
        shownUrl = { key: image.key, url: URL.createObjectURL(blob) };
        mainImage.src = shownUrl.url;
        mainImage.dataset.key = image.key;
      });
    }
    // The others small below, the large one marked (only with several images).
    list.replaceChildren(
      ...(images.length > 1
        ? images.map(other => {
            const thumb = h('img', { class: 'flow-pane__thumb-img', alt: other.name, draggable: false });
            void thumbnailUrl(other.key).then(url => url && (thumb.src = url));
            return h(
              'button',
              {
                class: `flow-pane__thumb${other.key === image?.key ? ' flow-pane__thumb--shown' : ''}`,
                title: `${other.name}（${sizeText(other)}）`,
                dataset: { key: other.key },
                onclick: () => {
                  chosen = other.key;
                  render();
                },
              },
              thumb,
            );
          })
        : []),
    );
  };

  main.addEventListener('click', () => {
    const image = current();
    if (image) opts.onOpen(image, title);
  });

  return {
    el,
    show(next) {
      setShown(el, next !== null, 'flex');
      // A new image (e.g. a new merge) is shown large again.
      if (next && next[0]?.key !== images[0]?.key) chosen = null;
      images = next ?? [];
      render();
    },
  };
}
