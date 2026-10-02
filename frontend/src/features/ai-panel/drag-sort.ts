/**
 * Drag & drop reordering of `.ai-tool-row` elements inside a container.
 * `onReorder` receives the new list of `data-tool-name` values.
 */

const ROW = '.ai-tool-row';

function clearIndicators(container: HTMLElement): void {
  for (const child of Array.from(container.children) as HTMLElement[]) {
    child.style.borderTop = '';
    child.style.borderBottom = '';
    child.style.transform = '';
  }
}

function rowOf(target: EventTarget | null): HTMLElement | null {
  return (target as HTMLElement | null)?.closest<HTMLElement>(ROW) ?? null;
}

export function enableDragSort(container: HTMLElement, onReorder: (names: string[]) => void): void {
  let dragged: HTMLElement | null = null;

  const currentOrder = () =>
    Array.from(container.querySelectorAll<HTMLElement>(ROW))
      .map(row => row.dataset.toolName)
      .filter(Boolean) as string[];

  container.addEventListener('dragstart', e => {
    const row = rowOf(e.target);
    if (!row) return;
    dragged = row;
    setTimeout(() => {
      if (dragged) dragged.style.opacity = '0.5';
    }, 0);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.toolName || '');
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
    const row = rowOf(e.target);
    if (!row || !dragged || row === dragged || !container.contains(row)) return;
    const rect = row.getBoundingClientRect();
    const below = e.clientY > rect.y + rect.height / 2;
    row.style.borderTop = below ? '' : '2px solid var(--color-primary)';
    row.style.borderBottom = below ? '2px solid var(--color-primary)' : '';
    row.style.transform = below ? 'translateY(-1px)' : 'translateY(1px)';
  });

  container.addEventListener('dragleave', e => {
    const row = rowOf(e.target);
    if (!row) return;
    const rect = row.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      row.style.borderTop = '';
      row.style.borderBottom = '';
      row.style.transform = '';
    }
  });

  container.addEventListener('drop', e => {
    e.preventDefault();
    clearIndicators(container);
    if (!dragged) return;
    const row = rowOf(e.target);
    if (row && row !== dragged && container.contains(row)) {
      const rect = row.getBoundingClientRect();
      if (e.clientY > rect.y + rect.height / 2) row.after(dragged);
      else row.before(dragged);
    } else if (e.target === container) {
      container.appendChild(dragged);
    } else {
      return;
    }
    onReorder(currentOrder());
  });
}
