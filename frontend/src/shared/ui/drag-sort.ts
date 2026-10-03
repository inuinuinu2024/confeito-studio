/**
 * Drag & drop reordering of the items matching `itemSelector` inside a container (the TOOLS list,
 * the reference images of the Gemini tools). Only items with `draggable = true` can be picked up.
 * `onReorder` receives the items in their new order.
 */

function clearIndicators(container: HTMLElement): void {
  for (const child of Array.from(container.children) as HTMLElement[]) {
    child.style.borderTop = '';
    child.style.borderBottom = '';
    child.style.transform = '';
  }
}

export function enableDragSort(
  container: HTMLElement,
  itemSelector: string,
  onReorder: (items: HTMLElement[]) => void,
): void {
  let dragged: HTMLElement | null = null;
  const itemOf = (target: EventTarget | null) =>
    (target as HTMLElement | null)?.closest<HTMLElement>(itemSelector) ?? null;

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
    const rect = item.getBoundingClientRect();
    const below = e.clientY > rect.y + rect.height / 2;
    item.style.borderTop = below ? '' : '2px solid var(--color-primary)';
    item.style.borderBottom = below ? '2px solid var(--color-primary)' : '';
    item.style.transform = below ? 'translateY(-1px)' : 'translateY(1px)';
  });

  container.addEventListener('dragleave', e => {
    const item = itemOf(e.target);
    if (!item) return;
    const rect = item.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      item.style.borderTop = '';
      item.style.borderBottom = '';
      item.style.transform = '';
    }
  });

  container.addEventListener('drop', e => {
    e.preventDefault();
    clearIndicators(container);
    if (!dragged) return;
    const item = itemOf(e.target);
    if (item && item !== dragged && container.contains(item)) {
      const rect = item.getBoundingClientRect();
      if (e.clientY > rect.y + rect.height / 2) item.after(dragged);
      else item.before(dragged);
    } else if (e.target === container) {
      container.appendChild(dragged);
    } else {
      return;
    }
    onReorder(Array.from(container.querySelectorAll<HTMLElement>(itemSelector)));
  });
}
