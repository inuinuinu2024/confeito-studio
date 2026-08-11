import { showToast } from '../../../shared/utils/toast';

export function createToolPromptDialog(): { 
  overlay: HTMLElement; 
  open: (toolName: string) => void; 
  close: () => void; 
} {
  const overlay = document.createElement('div');
  overlay.className = 'tool-prompt-overlay';
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
  dialog.className = 'tool-prompt-dialog';
  dialog.style.backgroundColor = 'var(--color-surface-container-highest)';
  dialog.style.padding = '24px';
  dialog.style.borderRadius = '8px';
  dialog.style.width = '480px';
  dialog.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
  dialog.style.display = 'flex';
  dialog.style.flexDirection = 'column';
  dialog.style.gap = '16px';
  dialog.style.border = '1px solid var(--color-outline-variant)';

  const title = document.createElement('h2');
  title.style.margin = '0';
  title.style.fontSize = '18px';
  title.style.color = 'var(--color-on-surface)';
  dialog.appendChild(title);

  // Prompt
  const posGroup = document.createElement('div');
  posGroup.style.display = 'flex';
  posGroup.style.flexDirection = 'column';
  posGroup.style.gap = '8px';

  const posLabel = document.createElement('label');
  posLabel.textContent = 'Prompt';
  posLabel.style.fontSize = '14px';
  posLabel.style.color = 'var(--color-on-surface-variant)';
  posGroup.appendChild(posLabel);

  const posInput = document.createElement('textarea');
  posInput.placeholder = 'Enter prompt...';
  posInput.style.padding = '8px';
  posInput.style.borderRadius = '4px';
  posInput.style.border = '1px solid var(--color-outline)';
  posInput.style.backgroundColor = 'var(--color-surface-container-lowest)';
  posInput.style.color = 'var(--color-on-surface)';
  posInput.style.width = '100%';
  posInput.style.height = '120px';
  posInput.style.resize = 'vertical';
  posGroup.appendChild(posInput);

  dialog.appendChild(posGroup);

  const buttonGroup = document.createElement('div');
  buttonGroup.style.display = 'flex';
  buttonGroup.style.justifyContent = 'flex-end';
  buttonGroup.style.gap = '8px';
  buttonGroup.style.marginTop = '8px';

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.style.padding = '8px 16px';
  clearBtn.style.borderRadius = '4px';
  clearBtn.style.border = '1px solid var(--color-outline)';
  clearBtn.style.backgroundColor = 'transparent';
  clearBtn.style.color = 'var(--color-error)';
  clearBtn.style.cursor = 'pointer';
  clearBtn.style.marginRight = 'auto'; // push to left
  buttonGroup.appendChild(clearBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.padding = '8px 16px';
  cancelBtn.style.borderRadius = '4px';
  cancelBtn.style.border = '1px solid var(--color-outline)';
  cancelBtn.style.backgroundColor = 'transparent';
  cancelBtn.style.color = 'var(--color-on-surface)';
  cancelBtn.style.cursor = 'pointer';
  buttonGroup.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.padding = '8px 16px';
  saveBtn.style.borderRadius = '4px';
  saveBtn.style.border = 'none';
  saveBtn.style.backgroundColor = 'var(--color-primary)';
  saveBtn.style.color = 'var(--color-on-primary)';
  saveBtn.style.cursor = 'pointer';
  buttonGroup.appendChild(saveBtn);

  dialog.appendChild(buttonGroup);
  overlay.appendChild(dialog);

  let currentToolName = '';

  const open = (toolName: string) => {
    currentToolName = toolName;
    title.textContent = `${toolName} Prompt`;
    
    // Load existing specific prompts from local storage if any
    posInput.value = localStorage.getItem(`toolPrompt_${toolName}`) || '';
    
    overlay.style.display = 'flex';
  };

  const close = () => {
    overlay.style.display = 'none';
  };

  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  clearBtn.addEventListener('click', () => {
    posInput.value = '';
  });

  saveBtn.addEventListener('click', () => {
    const posVal = posInput.value;
    
    if (posVal.trim()) {
      localStorage.setItem(`toolPrompt_${currentToolName}`, posVal);
      showToast(`${currentToolName} prompt saved`, 'success');
    } else {
      // If empty, remove from local storage
      localStorage.removeItem(`toolPrompt_${currentToolName}`);
      showToast(`${currentToolName} prompt cleared`, 'info');
    }
    close();
  });

  return { overlay, open, close };
}
