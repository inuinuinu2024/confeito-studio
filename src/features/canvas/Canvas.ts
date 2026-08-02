/**
 * Canvas — Central workspace with split compare view and floating toolbar.
 */
import { icon } from '../../shared/utils/dom';

const SOURCE_IMAGE =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuBOjBDI-NCafz1QuAcWVa7bAxd-XGA8SIyL1BXWHpoLE7uIzC5sQIVAGG6AcV3db4D-kwCIPM_sKETNx5UTvSyw6Wi6GSRsFzqHaEnBvdxe6r_7yPP2MCoh0fwwJXs5S3VFMhP3sogaFVTpEMVFCUusjbRGMr9_X8sRV89K351R5XVcA08yPFPUWoU6B5gOqAvWPCPSbx_9qH6ArYrbFc22JpW9ooxDInwMim-MP8JbeYtcpY2VlQmIrDJ9YMoeHoS5dHVxlux57kVA';

const RESULT_IMAGE =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuBvTrajqudV6c47ff4nSnUjdL3rAEa33nQiubGB1a7BImcL6XsTTejwx4AuLg6oim9P-Bc-foNKzuSG4Y2Xg86wzrDAeV3XgqV5vZLsYnVbjzfyKQUT3747b53iQ6BF65Ol9ABFXLH-pxFQ8RRbeP8PYvMm3Wfvjdxl7vJ-ZbtfXpOwqrUSIB589oLXg6gHcKdtlsqx4QnO0D6l8HBxoOgT0o4lCyynTTJ1NGsZepfyv0r4Pyh-3hDjjiiyQorfIx29k9Vqviqfv1Gw';

export function createCanvas(): HTMLElement {
  const main = document.createElement('main');
  main.className = 'canvas-area';

  // ── Floating Canvas Toolbar ──
  const toolbar = document.createElement('div');
  toolbar.className = 'canvas-toolbar';

  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'canvas-toolbar__zoom';
  zoomLabel.textContent = 'Zoom: 150%';
  toolbar.appendChild(zoomLabel);

  const divider = document.createElement('div');
  divider.className = 'canvas-toolbar__divider';
  toolbar.appendChild(divider);

  const compareGroup = document.createElement('div');
  compareGroup.className = 'canvas-toolbar__compare';

  const compareIcon = icon('compare', 18);
  compareIcon.classList.add('canvas-toolbar__compare-icon');
  compareGroup.appendChild(compareIcon);

  const compareLabel = document.createElement('span');
  compareLabel.className = 'canvas-toolbar__compare-label';
  compareLabel.textContent = 'Compare Mode';
  compareGroup.appendChild(compareLabel);

  const toggle = document.createElement('div');
  toggle.className = 'toggle toggle--on';
  const knob = document.createElement('div');
  knob.className = 'toggle__knob';
  toggle.appendChild(knob);

  toggle.addEventListener('click', () => {
    toggle.classList.toggle('toggle--on');
    toggle.classList.toggle('toggle--off');
  });

  compareGroup.appendChild(toggle);
  toolbar.appendChild(compareGroup);
  main.appendChild(toolbar);

  // ── Split View ──
  const splitView = document.createElement('div');
  splitView.className = 'canvas-split';

  // Source panel
  const sourcePanel = document.createElement('div');
  sourcePanel.className = 'canvas-split__panel';
  sourcePanel.style.backgroundImage = `url('${SOURCE_IMAGE}')`;
  sourcePanel.style.backgroundSize = 'cover';
  sourcePanel.style.backgroundPosition = 'center';

  const sourceLabel = document.createElement('div');
  sourceLabel.className = 'canvas-split__label canvas-split__label--source';
  sourceLabel.textContent = 'Source (Inks_Clean)';
  sourcePanel.appendChild(sourceLabel);
  splitView.appendChild(sourcePanel);

  // Divider
  const splitDivider = document.createElement('div');
  splitDivider.className = 'canvas-split__divider';
  const handle = document.createElement('div');
  handle.className = 'canvas-split__divider-handle';
  handle.appendChild(icon('drag_indicator', 14));
  splitDivider.appendChild(handle);
  splitView.appendChild(splitDivider);

  // Draggable divider logic
  let isDragging = false;
  splitDivider.addEventListener('mousedown', () => {
    isDragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const rect = splitView.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(10, Math.min(90, (x / rect.width) * 100));
    sourcePanel.style.flex = `0 0 ${pct}%`;
    resultPanel.style.flex = `0 0 ${100 - pct}%`;
  });
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });

  // AI Result panel
  const resultPanel = document.createElement('div');
  resultPanel.className = 'canvas-split__panel';
  resultPanel.style.backgroundImage = `url('${RESULT_IMAGE}')`;
  resultPanel.style.backgroundSize = 'cover';
  resultPanel.style.backgroundPosition = 'center';

  const resultLabel = document.createElement('div');
  resultLabel.className = 'canvas-split__label canvas-split__label--result';
  resultLabel.textContent = 'AI Result preview';
  resultPanel.appendChild(resultLabel);
  splitView.appendChild(resultPanel);

  main.appendChild(splitView);

  // Listen for PSD loaded event to render the image
  window.addEventListener('document:loaded', (e: Event) => {
    const customEvent = e as CustomEvent<{ psd: any; filename: string }>;
    const psd = customEvent.detail.psd;

    if (psd.canvas) {
      // Clear dummy backgrounds
      sourcePanel.style.backgroundImage = 'none';
      resultPanel.style.backgroundImage = 'none';

      // Remove any previously appended canvas elements
      sourcePanel.querySelectorAll('canvas').forEach(c => c.remove());
      resultPanel.querySelectorAll('canvas').forEach(c => c.remove());

      // Clone the canvas for the result panel, use original for source
      const sourceCanvas = psd.canvas;
      const resultCanvas = document.createElement('canvas');
      resultCanvas.width = sourceCanvas.width;
      resultCanvas.height = sourceCanvas.height;
      const ctx = resultCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(sourceCanvas, 0, 0);
      }

      // Style both canvases
      const styleCanvas = (c: HTMLCanvasElement) => {
        c.style.width = '100%';
        c.style.height = '100%';
        c.style.objectFit = 'contain';
        // Make sure it sits behind the labels
        c.style.position = 'absolute';
        c.style.top = '0';
        c.style.left = '0';
        c.style.zIndex = '0';
      };

      styleCanvas(sourceCanvas);
      styleCanvas(resultCanvas);
      
      // The panels need to be relative for absolute positioning of children
      sourcePanel.style.position = 'relative';
      resultPanel.style.position = 'relative';
      
      // Ensure labels are above the canvas
      sourceLabel.style.position = 'relative';
      sourceLabel.style.zIndex = '1';
      resultLabel.style.position = 'relative';
      resultLabel.style.zIndex = '1';

      sourcePanel.appendChild(sourceCanvas);
      resultPanel.appendChild(resultCanvas);
    }
  });

  return main;
}
