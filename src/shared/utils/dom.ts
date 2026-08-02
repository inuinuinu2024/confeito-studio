/**
 * DOM helper utilities for creating elements concisely.
 */

/** Create an HTML element with attributes and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...children: (HTMLElement | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'textContent') {
        element.textContent = value;
      } else {
        element.setAttribute(key, value);
      }
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      element.appendChild(document.createTextNode(child));
    } else {
      element.appendChild(child);
    }
  }
  return element;
}

/** Create a Material Symbols Outlined icon span. */
export function icon(name: string, size?: number): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'material-symbols-outlined';
  if (size) span.style.fontSize = `${size}px`;
  span.textContent = name;
  return span;
}
