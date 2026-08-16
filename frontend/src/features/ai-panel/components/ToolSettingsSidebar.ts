import { icon } from '../../../shared/utils/dom';

export function createToolSettingsSidebar(): {
  overlay: HTMLElement;
  open: (toolName: string, renderSettings: (container: HTMLElement) => void, onExecute?: () => void, onColoringExecute?: () => void) => void;
  close: () => void;
} {
  const overlay = document.createElement('div');
  overlay.className = 'tool-settings-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.backgroundColor = 'transparent';
  overlay.style.display = 'none';
  overlay.style.zIndex = '9998';
  overlay.style.pointerEvents = 'none';

  const sidebar = document.createElement('div');
  sidebar.className = 'tool-settings-sidebar';
  sidebar.style.position = 'fixed';
  sidebar.style.top = '48px'; // Adjust for TopBar height
  sidebar.style.right = '0';
  sidebar.style.width = '360px';
  sidebar.style.height = 'calc(100vh - 48px)';
  sidebar.style.backgroundColor = '#201e22';
  sidebar.style.borderLeft = '1px solid var(--color-outline-variant)';
  sidebar.style.boxShadow = '-4px 0 16px rgba(0,0,0,0.5)';
  sidebar.style.transform = 'translateX(100%)';
  sidebar.style.transition = 'transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)';
  sidebar.style.display = 'flex';
  sidebar.style.flexDirection = 'column';
  sidebar.style.zIndex = '9999';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.padding = '16px';
  header.style.borderBottom = '1px solid var(--color-outline-variant)';

  const title = document.createElement('h2');
  title.style.margin = '0';
  title.style.fontSize = '16px';
  title.style.fontWeight = '600';
  title.style.color = 'var(--color-on-surface)';

  const closeBtn = document.createElement('button');
  closeBtn.style.background = 'none';
  closeBtn.style.border = 'none';
  closeBtn.style.color = 'var(--color-on-surface-variant)';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.padding = '4px';
  closeBtn.style.display = 'flex';
  closeBtn.appendChild(icon('close', 20));

  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.style.padding = '16px';
  body.style.flex = '1';
  body.style.overflowY = 'auto';
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.gap = '16px';

  sidebar.appendChild(header);
  sidebar.appendChild(body);

  const footer = document.createElement('div');
  footer.style.padding = '16px';
  footer.style.borderTop = '1px solid var(--color-outline-variant)';
  footer.style.display = 'flex';
  footer.style.flexDirection = 'column';
  footer.style.gap = '8px';
  
  const coloringBtn = document.createElement('button');
  coloringBtn.style.width = '100%';
  coloringBtn.style.padding = '12px';
  coloringBtn.style.borderRadius = '4px';
  coloringBtn.style.border = 'none';
  coloringBtn.style.backgroundColor = 'var(--color-primary)';
  coloringBtn.style.color = 'var(--color-on-primary)';
  coloringBtn.style.cursor = 'pointer';
  coloringBtn.style.display = 'none';
  coloringBtn.style.alignItems = 'center';
  coloringBtn.style.justifyContent = 'center';
  coloringBtn.style.gap = '8px';
  coloringBtn.style.fontWeight = '600';
  coloringBtn.appendChild(icon('auto_awesome', 18));
  coloringBtn.appendChild(document.createTextNode('着彩する'));
  coloringBtn.addEventListener('click', () => {
    if (currentOnColoringExecute) {
      currentOnColoringExecute();
    } else {
      alert('着彩機能は現在作成中です。');
    }
  });
  
  const generateBtn = document.createElement('button');
  generateBtn.style.width = '100%';
  generateBtn.style.padding = '12px';
  generateBtn.style.borderRadius = '4px';
  generateBtn.style.border = 'none';
  generateBtn.style.backgroundColor = 'var(--color-primary)';
  generateBtn.style.color = 'var(--color-on-primary)';
  generateBtn.style.cursor = 'pointer';
  generateBtn.style.display = 'flex';
  generateBtn.style.alignItems = 'center';
  generateBtn.style.justifyContent = 'center';
  generateBtn.style.gap = '8px';
  generateBtn.style.fontWeight = '600';
  generateBtn.appendChild(icon('auto_awesome', 18));
  generateBtn.appendChild(document.createTextNode('生成する'));
  
  footer.appendChild(coloringBtn);
  footer.appendChild(generateBtn);
  sidebar.appendChild(footer);

  let isOpen = false;
  let currentOnExecute: (() => void) | null = null;
  let currentOnColoringExecute: (() => void) | null = null;

  generateBtn.addEventListener('click', () => {
    if (currentOnExecute) {
      currentOnExecute();
    }
  });

  const open = (
    toolName: string, 
    renderSettings: (container: HTMLElement) => void, 
    onExecute?: () => void, 
    onColoringExecute?: () => void,
    executeLabel?: string,
    executeIcon?: string | null
  ) => {
    title.textContent = toolName;
    body.innerHTML = ''; // Clear previous settings
    currentOnExecute = onExecute || null;
    currentOnColoringExecute = onColoringExecute || null;
    
    // Update generate button text and icon
    generateBtn.innerHTML = '';
    if (executeIcon !== null) {
      generateBtn.appendChild(icon(executeIcon || 'auto_awesome', 18));
    }
    generateBtn.appendChild(document.createTextNode(executeLabel || '生成する'));
    
    if (currentOnColoringExecute) {
      coloringBtn.style.display = 'flex';
      generateBtn.style.display = 'none';
    } else {
      coloringBtn.style.display = 'none';
      generateBtn.style.display = 'flex';
    }
    
    renderSettings(body);
    
    overlay.style.display = 'block';
    document.body.appendChild(sidebar);
    
    // Trigger reflow
    void sidebar.offsetHeight;
    
    sidebar.style.transform = 'translateX(0)';
    isOpen = true;
  };

  const close = () => {
    if (!isOpen) return;
    sidebar.style.transform = 'translateX(100%)';
    isOpen = false;
    setTimeout(() => {
      overlay.style.display = 'none';
      if (sidebar.parentElement) {
        sidebar.parentElement.removeChild(sidebar);
      }
    }, 300);
  };

  closeBtn.addEventListener('click', close);
  // overlay.addEventListener('click', close); // Disable closing on outside click

  return { overlay, open, close };
}
