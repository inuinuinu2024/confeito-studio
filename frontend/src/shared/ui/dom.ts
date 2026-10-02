/**
 * DOM building helpers.
 *
 *   h('button', { class: 'cs-btn', text: 'OK', onclick: save })
 *   h('div', { class: 'row', style: { gap: '8px' } }, label, input)
 *
 * Props are assigned as element properties (value, type, min, title, disabled, onclick...),
 * except `class`, `style`, `text`, `dataset` and `attrs`, which are handled specially.
 */

type Child = Node | string | null | undefined | false;

type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style' | 'dataset'>> & {
  class?: string;
  style?: Partial<CSSStyleDeclaration>;
  text?: string;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    const { class: className, style, text, dataset, attrs, ...rest } = props;
    if (className) el.className = className;
    if (style) Object.assign(el.style, style);
    if (text !== undefined) el.textContent = text;
    if (dataset) Object.assign(el.dataset, dataset);
    if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    Object.assign(el, rest);
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) el.append(child);
  }
  return el;
}

/** Material Symbols Outlined icon. */
export function icon(name: string, size?: number): HTMLSpanElement {
  const span = h('span', { class: 'material-symbols-outlined', text: name });
  if (size) span.style.fontSize = `${size}px`;
  return span;
}

/** Shows/hides an element by toggling `display` between `shown` and `none`. */
export function setShown(el: HTMLElement, visible: boolean, shown = ''): void {
  el.style.display = visible ? shown : 'none';
}
