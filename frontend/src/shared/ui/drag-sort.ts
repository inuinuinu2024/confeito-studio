/**
 * Drag & drop reordering of the items matching `itemSelector` inside a container (the TOOLS list,
 * the reference images of the Gemini tools). Only items with `draggable = true` can be picked up.
 * `onReorder` receives the items in their new order. Items are compared top / bottom halves, or left / right
 * halves with `axis: 'x'` (a row of thumbnails, which may wrap).
 */

function clearIndicators(container: HTMLElement): void {
  for (const child of Array.from(container.children) as HTMLElement[]) {
    clearIndicator(child);
  }
}

function clearIndicator(item: HTMLElement): void {
  item.style.borderTop = '';
  item.style.borderBottom = '';
  item.style.borderLeft = '';
  item.style.borderRight = '';
  item.style.transform = '';
}

export function enableDragSort(
  container: HTMLElement,
  itemSelector: string,
  onReorder: (items: HTMLElement[]) => void,
  axis: 'x' | 'y' = 'y',
): void {
  let dragged: HTMLElement | null = null;
  const itemOf = (target: EventTarget | null) =>
    (target as HTMLElement | null)?.closest<HTMLElement>(itemSelector) ?? null;
  /** Whether the pointer is on the second half (below / right of the middle) of the item. */
  const isAfter = (item: HTMLElement, e: DragEvent) => {
    const rect = item.getBoundingClientRect();
    return axis === 'x' ? e.clientX > rect.x + rect.width / 2 : e.clientY > rect.y + rect.height / 2;
  };

  container.addEventListener('dragstart', e => {
    const item = itemOf(e.target);
    if (!item) return;
    dragged = item;
    setTimeout(() => {
      if (dragged) dragged.style.opacity = '0.5';
    }, 0);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
    }
  });

  container.addEventListener('dragend', () => {
    setTimeout(() => {
      if (dragged) dragged.style.opacity = '1';
      dragged = null;
      clearIndicators(container);
    }, 0);
  });

  container.addEventListener('dragover', e => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const item = itemOf(e.target);
    if (!item || !dragged || item === dragged || !container.contains(item)) return;
    const after = isAfter(item, e);
    const line = '2px solid var(--color-primary)';
    if (axis === 'x') {
      item.style.borderLeft = after ? '' : line;
      item.style.borderRight = after ? line : '';
    } else {
      item.style.borderTop = after ? '' : line;
      item.style.borderBottom = after ? line : '';
      item.style.transform = after ? 'translateY(-1px)' : 'translateY(1px)';
    }
  });

  container.addEventListener('dragleave', e => {
    const item = itemOf(e.target);
    if (!item) return;
    const rect = item.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      clearIndicator(item);
    }
  });

  container.addEventListener('drop', e => {
    e.preventDefault();
    clearIndicators(container);
    if (!dragged) return;
    const item = itemOf(e.target);
    if (item && item !== dragged && container.contains(item)) {
      if (isAfter(item, e)) item.after(dragged);
      else item.before(dragged);
    } else if (e.target === container) {
      container.appendChild(dragged);
    } else {
      return;
    }
    onReorder(Array.from(container.querySelectorAll<HTMLElement>(itemSelector)));
  });
}
