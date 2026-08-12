/**
 * DOM helper utilities for creating elements concisely.
 */

/** Create a Material Symbols Outlined icon span. */
export function icon(name: string, size?: number): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'material-symbols-outlined';
  if (size) span.style.fontSize = `${size}px`;
  span.textContent = name;
  return span;
}
