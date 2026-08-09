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
  statusText.textContent = 'ComfyUI Node Status: PROCESSING | Latent: 1024x1024';
  left.appendChild(statusText);

  // Progress bar
  const progress = document.createElement('div');
  progress.className = 'statusbar__progress';
  const fill = document.createElement('div');
  fill.className = 'statusbar__progress-fill';
  fill.style.width = '48%';
  progress.appendChild(fill);
  left.appendChild(progress);

  const steps = document.createElement('span');
  steps.className = 'statusbar__steps';
  steps.textContent = 'Steps: 12/25';
  left.appendChild(steps);

  footer.appendChild(left);



  // ── Right: VRAM ──
  const right = document.createElement('div');
  right.className = 'statusbar__right';
  right.textContent = 'VRAM: 8.2GB / 12GB';
  footer.appendChild(right);

  return footer;
}
