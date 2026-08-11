/**
 * StatusBar — Bottom footer with processing status, progress bar,
 * links, and VRAM info.
 */
import { showToast } from '../../shared/utils/toast';

export function createStatusBar(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'statusbar';

  // ── Left: Processing status ──
  const left = document.createElement('div');
  left.className = 'statusbar__left';

  const statusText = document.createElement('span');
  statusText.textContent = 'Ready';
  left.appendChild(statusText);

  // Progress bar
  const progress = document.createElement('div');
  progress.className = 'statusbar__progress';
  progress.style.display = 'none'; // hidden by default

  const fill = document.createElement('div');
  fill.className = 'statusbar__progress-fill';
  fill.style.width = '100%';
  fill.style.animation = 'progress-indeterminate 1.5s infinite linear';
  progress.appendChild(fill);
  left.appendChild(progress);

  const steps = document.createElement('span');
  steps.className = 'statusbar__steps';
  steps.textContent = '';
  left.appendChild(steps);

  footer.appendChild(left);

  // ── Right: Status Indicators ──
  const right = document.createElement('div');
  right.className = 'statusbar__right';

  // Internet Status
  const internetStatus = document.createElement('div');
  internetStatus.className = 'statusbar__status-item';
  
  const internetDot = document.createElement('span');
  internetDot.className = 'statusbar__status-dot';
  const internetText = document.createTextNode('');
  
  internetStatus.appendChild(internetDot);
  internetStatus.appendChild(internetText);
  right.appendChild(internetStatus);

  const updateInternetStatus = () => {
    const isOnline = navigator.onLine;
    internetDot.style.backgroundColor = isOnline ? 'var(--color-success, #4ade80)' : 'var(--color-error, #f87171)';
    internetDot.style.boxShadow = isOnline ? '0 0 8px var(--color-success, #4ade80)' : '0 0 8px var(--color-error, #f87171)';
    internetText.textContent = `Internet: ${isOnline ? 'Online' : 'Offline'}`;
  };
  
  window.addEventListener('online', updateInternetStatus);
  window.addEventListener('offline', updateInternetStatus);
  updateInternetStatus();

  // Gemini Status
  const geminiStatus = document.createElement('div');
  geminiStatus.className = 'statusbar__status-item';
  
  const geminiDot = document.createElement('span');
  geminiDot.className = 'statusbar__status-dot';
  
  const geminiText = document.createTextNode('Gemini: Checking...');
  
  geminiStatus.appendChild(geminiDot);
  geminiStatus.appendChild(geminiText);
  right.appendChild(geminiStatus);

  const updateGeminiStatus = () => {
    const hasKey = !!localStorage.getItem('geminiApiKey');
    if (hasKey) {
      geminiDot.style.backgroundColor = 'var(--color-success, #4ade80)';
      geminiDot.style.boxShadow = '0 0 8px var(--color-success, #4ade80)';
      geminiText.textContent = 'Gemini: Ready';
    } else {
      geminiDot.style.backgroundColor = 'var(--color-error, #f87171)';
      geminiDot.style.boxShadow = '0 0 8px var(--color-error, #f87171)';
      geminiText.textContent = 'Gemini: Missing Key';
    }
  };

  window.addEventListener('settings:updated', updateGeminiStatus);
  updateGeminiStatus();

  // ComfyUI Status
  const comfyStatus = document.createElement('div');
  comfyStatus.className = 'statusbar__status-item';
  
  const comfyDot = document.createElement('span');
  comfyDot.className = 'statusbar__status-dot';
  
  const comfyText = document.createTextNode('ComfyUI: Checking...');
  
  comfyStatus.appendChild(comfyDot);
  comfyStatus.appendChild(comfyText);
  right.appendChild(comfyStatus);

  const updateComfyStatus = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      // Ping ComfyUI system stats endpoint
      const res = await fetch('http://127.0.0.1:8188/system_stats', { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (res.ok) {
        comfyDot.style.backgroundColor = 'var(--color-success, #4ade80)';
        comfyDot.style.boxShadow = '0 0 8px var(--color-success, #4ade80)';
        comfyText.textContent = 'ComfyUI: Connected';
      } else {
        throw new Error('Status not OK');
      }
    } catch (err) {
      comfyDot.style.backgroundColor = 'var(--color-error, #f87171)';
      comfyDot.style.boxShadow = '0 0 8px var(--color-error, #f87171)';
      comfyText.textContent = 'ComfyUI: Disconnected';
    }
  };

  updateComfyStatus();
  // Poll every 5 seconds
  setInterval(updateComfyStatus, 5000);

  footer.appendChild(right);

  // ── Event Listeners ──
  window.addEventListener('tool:start', (e: Event) => {
    const customEvent = e as CustomEvent<{ toolName: string }>;
    statusText.textContent = `Running: ${customEvent.detail.toolName}...`;
    progress.style.display = 'block';
  });

  window.addEventListener('tool:end', () => {
    statusText.textContent = 'Ready';
    progress.style.display = 'none';
  });

  return footer;
}
