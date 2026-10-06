/** Drag handle that resizes a sidebar by updating a CSS width variable on :root. */

const MIN_WIDTH = 150;
const MAX_WIDTH = 600;

/**
 * @param panel     sidebar whose current width is the starting point
 * @param cssVar    e.g. "--left-sidebar-width"
 * @param edge      "right" when the handle sits on the panel's right edge (left sidebar)
 * @param onResized called with the width when a drag ends (e.g. to save it)
 */
export function createResizer(
  panel: HTMLElement,
  cssVar: string,
  edge: 'left' | 'right',
  className: string,
  onResized?: (width: number) => void,
): HTMLDivElement {
  const handle = document.createElement('div');
  handle.className = className;
  let startX = 0;
  let startWidth = 0;

  const onMove = (e: MouseEvent) => {
    const delta = e.clientX - startX;
    const width = edge === 'right' ? startWidth + delta : startWidth - delta;
    if (width > MIN_WIDTH && width < MAX_WIDTH) document.documentElement.style.setProperty(cssVar, `${width}px`);
  };
  const onUp = () => {
    document.body.style.cursor = '';
    onResized?.(panel.getBoundingClientRect().width);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  handle.addEventListener('mousedown', e => {
    startX = e.clientX;
    startWidth = panel.getBoundingClientRect().width;
    document.body.style.cursor = 'ew-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
  return handle;
}
