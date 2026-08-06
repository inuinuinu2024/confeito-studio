/**
 * Toolbar — Left vertical navigation rail with tool icons.
 */
import { icon } from '../../shared/utils/dom';
import { showToast } from '../../shared/utils/toast';

interface ToolDef {
  name: string;
  iconName: string;
  active?: boolean;
}

const tools: ToolDef[] = [
  { name: 'Brush',      iconName: 'brush' },
  { name: 'Layers',     iconName: 'layers',       active: true },
  { name: 'AI Effects',  iconName: 'auto_fix_high' },
  { name: 'History',    iconName: 'history' },
  { name: 'Files',      iconName: 'folder_open' },
  { name: 'Settings',   iconName: 'tune' },
];

export function createToolbar(): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'toolbar';

  // ── Tool buttons ──
  const toolsDiv = document.createElement('div');
  toolsDiv.className = 'toolbar__tools';

  for (const tool of tools) {
    const btn = document.createElement('button');
    btn.className = tool.active
      ? 'toolbar__btn toolbar__btn--active'
      : 'toolbar__btn';
    btn.title = tool.name;
    btn.appendChild(icon(tool.iconName, 20));

    // Click interaction: activate selected tool
    btn.addEventListener('click', () => {
      toolsDiv.querySelectorAll('.toolbar__btn').forEach((b) => {
        b.classList.remove('toolbar__btn--active');
      });
      btn.classList.add('toolbar__btn--active');
      showToast(tool.name, true);
    });

    toolsDiv.appendChild(btn);
  }
  nav.appendChild(toolsDiv);

  // ── Bottom status icon ──
  const bottomDiv = document.createElement('div');
  bottomDiv.className = 'toolbar__bottom';
  const statusBtn = document.createElement('button');
  statusBtn.className = 'toolbar__btn';
  statusBtn.title = 'Status: Connected';
  const statusIcon = icon('sensors', 20);
  statusIcon.style.color = 'var(--color-secondary)';
  statusBtn.appendChild(statusIcon);
  statusBtn.addEventListener('click', () => showToast('接続状態', true));
  bottomDiv.appendChild(statusBtn);
  nav.appendChild(bottomDiv);

  return nav;
}
