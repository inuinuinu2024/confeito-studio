import { showToast } from '../../../shared/utils/toast';

export function createBgColorDialog(): { overlay: HTMLElement; open: () => void; close: () => void } {
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  overlay.style.display = 'none';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '9999';

  const dialog = document.createElement('div');
  dialog.className = 'settings-dialog';
  dialog.style.backgroundColor = 'var(--color-surface-container-highest)';
  dialog.style.padding = '24px';
  dialog.style.borderRadius = '8px';
  dialog.style.width = '320px';
  dialog.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
  dialog.style.display = 'flex';
  dialog.style.flexDirection = 'column';
  dialog.style.gap = '16px';
  dialog.style.border = '1px solid var(--color-outline-variant)';

  const title = document.createElement('h2');
  title.textContent = 'Canvas Background Color';
  title.style.margin = '0';
  title.style.fontSize = '18px';
  title.style.color = 'var(--color-on-surface)';
  dialog.appendChild(title);

  const colors = [
    { label: 'White', hex: '#FFFFFF' },
    { label: 'Light Gray 1', hex: '#D9D9D9' },
    { label: 'Light Gray 2', hex: '#B3B3B3' },
    { label: 'Gray', hex: '#8C8C8C' },
    { label: 'Dark Gray 1', hex: '#666666' },
    { label: 'Dark Gray 2', hex: '#404040' },
    { label: 'Dark Gray 3', hex: '#1A1A1A' },
    { label: 'Black', hex: '#000000' },
  ];

  const palette = document.createElement('div');
  palette.style.display = 'grid';
  palette.style.gridTemplateColumns = 'repeat(4, 1fr)';
  palette.style.gap = '8px';

  for (const color of colors) {
    const btn = document.createElement('button');
    btn.style.width = '100%';
    btn.style.aspectRatio = '1 / 1';
    btn.style.borderRadius = '4px';
    btn.style.border = '1px solid var(--color-outline)';
    btn.style.backgroundColor = color.hex;
    btn.style.cursor = 'pointer';
    btn.title = color.label;
    btn.style.transition = 'transform 0.1s ease';

    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'scale(1.1)';
      btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'scale(1)';
      btn.style.boxShadow = 'none';
    });

    btn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('canvas:bg-color', { detail: { color: color.hex } }));
      showToast(`Background set to ${color.label}`, 'success');
      close();
    });

    palette.appendChild(btn);
  }
  dialog.appendChild(palette);

  const buttonGroup = document.createElement('div');
  buttonGroup.style.display = 'flex';
  buttonGroup.style.justifyContent = 'flex-end';
  buttonGroup.style.gap = '8px';
  buttonGroup.style.marginTop = '8px';



  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.padding = '8px 16px';
  cancelBtn.style.borderRadius = '4px';
  cancelBtn.style.border = 'none';
  cancelBtn.style.backgroundColor = 'var(--color-surface-container-low)';
  cancelBtn.style.color = 'var(--color-on-surface)';
  cancelBtn.style.cursor = 'pointer';
  cancelBtn.addEventListener('click', () => close());
  buttonGroup.appendChild(cancelBtn);

  dialog.appendChild(buttonGroup);
  overlay.appendChild(dialog);

  const open = () => {
    overlay.style.display = 'flex';
  };

  const close = () => {
    overlay.style.display = 'none';
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return { overlay, open, close };
}
