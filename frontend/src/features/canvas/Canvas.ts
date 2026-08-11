/**
 * Canvas — Central workspace with split compare view and floating toolbar.
 */
import { icon } from '../../shared/utils/dom';
import { getImageCache } from '../../shared/utils/idb';
import { showToast } from '../../shared/utils/toast';

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

  const compareGroup = document.createElement('div');
  compareGroup.className = 'canvas-toolbar__compare';

  // Compare Mode Toggle (Dummy)
  const compareModeIcon = icon('vertical_split', 18);
  compareModeIcon.classList.add('canvas-toolbar__compare-icon');
  compareGroup.appendChild(compareModeIcon);

  const compareModeLabel = document.createElement('span');
  compareModeLabel.className = 'canvas-toolbar__compare-label';
  compareModeLabel.textContent = 'Compare Mode';
  compareGroup.appendChild(compareModeLabel);

  const compareModeToggle = document.createElement('div');
  compareModeToggle.className = 'toggle toggle--off';
  const compareModeKnob = document.createElement('div');
  compareModeKnob.className = 'toggle__knob';
  compareModeToggle.appendChild(compareModeKnob);
  
  compareModeToggle.addEventListener('click', () => {
    const wasOn = compareModeToggle.classList.contains('toggle--on');
    compareModeToggle.classList.toggle('toggle--on');
    compareModeToggle.classList.toggle('toggle--off');
    window.dispatchEvent(new CustomEvent('compare-mode:toggle', { detail: { enabled: !wasOn } }));
  });
  
  compareGroup.appendChild(compareModeToggle);

  // Spacer
  const spacer = document.createElement('div');
  spacer.style.width = '16px';
  compareGroup.appendChild(spacer);

  // Slider Toggle (Functional)
  const sliderIcon = icon('compare', 18);
  sliderIcon.classList.add('canvas-toolbar__compare-icon');
  compareGroup.appendChild(sliderIcon);

  const compareLabel = document.createElement('span');
  compareLabel.className = 'canvas-toolbar__compare-label';
  compareLabel.textContent = 'Slider';
  compareGroup.appendChild(compareLabel);

  const toggle = document.createElement('div');
  toggle.className = 'toggle toggle--on';
  const knob = document.createElement('div');
  knob.className = 'toggle__knob';
  toggle.appendChild(knob);

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
  sourcePanel.style.backgroundSize = 'contain';
  sourcePanel.style.backgroundPosition = 'center';
  sourcePanel.style.backgroundRepeat = 'no-repeat';



  // Divider
  const splitDivider = document.createElement('div');
  splitDivider.className = 'canvas-split__divider';
  const handle = document.createElement('div');
  handle.className = 'canvas-split__divider-handle';
  handle.appendChild(icon('drag_indicator', 14));
  splitDivider.appendChild(handle);
  splitDivider.appendChild(handle);

  // Draggable divider logic
  let isDragging = false;
  splitDivider.addEventListener('mousedown', () => {
    isDragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const rect = splitViewInner.getBoundingClientRect();
    const x = e.clientX - rect.left;
    splitPct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    
    // Fast update during drag
    sourcePanel.style.clipPath = `polygon(0 0, ${splitPct}% 0, ${splitPct}% 100%, 0 100%)`;
    splitDivider.style.left = `${splitPct}%`;
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
  resultPanel.style.backgroundSize = 'contain';
  resultPanel.style.backgroundPosition = 'center';
  resultPanel.style.backgroundRepeat = 'no-repeat';

  // Inner container to avoid padding issues with absolute positioning
  const splitViewInner = document.createElement('div');
  splitViewInner.style.flex = '1';
  splitViewInner.style.display = 'flex';
  splitViewInner.style.position = 'relative';
  
  splitViewInner.appendChild(sourcePanel);
  splitViewInner.appendChild(splitDivider);
  splitViewInner.appendChild(resultPanel);

  splitView.appendChild(splitViewInner);

  let compareMode = true;
  let isCacheSelected = false;
  let splitPct = 50;

  function updateCanvasLayout() {
    compareGroup.style.display = 'flex';
    if (isCacheSelected) {
      if (compareMode) {
        resultPanel.style.display = '';
        splitDivider.style.display = 'flex';
        
        // OVERLAY Layout
        splitViewInner.style.gap = '0';
        
        sourcePanel.style.flex = 'none';
        sourcePanel.style.position = 'absolute';
        sourcePanel.style.top = '0';
        sourcePanel.style.left = '0';
        sourcePanel.style.width = '100%';
        sourcePanel.style.height = '100%';
        sourcePanel.style.zIndex = '2';
        sourcePanel.style.clipPath = `polygon(0 0, ${splitPct}% 0, ${splitPct}% 100%, 0 100%)`;

        resultPanel.style.flex = 'none';
        resultPanel.style.position = 'absolute';
        resultPanel.style.top = '0';
        resultPanel.style.left = '0';
        resultPanel.style.width = '100%';
        resultPanel.style.height = '100%';
        resultPanel.style.zIndex = '1';
        resultPanel.style.clipPath = 'none';

        splitDivider.style.position = 'absolute';
        splitDivider.style.top = '0';
        splitDivider.style.bottom = '0';
        splitDivider.style.left = `${splitPct}%`;
        splitDivider.style.transform = 'translateX(-50%)';
        splitDivider.style.zIndex = '3';
        
      } else {
        resultPanel.style.display = '';
        splitDivider.style.display = 'none';
        
        // SIDE BY SIDE Layout
        splitViewInner.style.gap = '16px';
        
        sourcePanel.style.flex = '1';
        sourcePanel.style.position = 'relative';
        sourcePanel.style.width = 'auto';
        sourcePanel.style.height = 'auto';
        sourcePanel.style.zIndex = '';
        sourcePanel.style.clipPath = 'none';

        resultPanel.style.flex = '1';
        resultPanel.style.position = 'relative';
        resultPanel.style.width = 'auto';
        resultPanel.style.height = 'auto';
        resultPanel.style.zIndex = '';
        resultPanel.style.clipPath = 'none';
      }
    } else {
      resultPanel.style.display = 'none';
      splitDivider.style.display = 'none';
      
      // SINGLE Layout
      splitViewInner.style.gap = '0';
      
      sourcePanel.style.flex = '1';
      sourcePanel.style.position = 'relative';
      sourcePanel.style.width = 'auto';
      sourcePanel.style.height = 'auto';
      sourcePanel.style.zIndex = '';
      sourcePanel.style.clipPath = 'none';
    }
  }

  toggle.addEventListener('click', () => {
    if (!compareMode && !compareModeToggle.classList.contains('toggle--on') && !isCacheSelected) {
      showToast('Cannot enable Slider when Compare Mode is OFF and no cache is selected.', 'error');
      return;
    }
    compareMode = !compareMode;
    toggle.classList.toggle('toggle--on', compareMode);
    toggle.classList.toggle('toggle--off', !compareMode);
    updateCanvasLayout();
  });
  
  function checkSliderAutoOff() {
    const isGlobalCompareMode = compareModeToggle.classList.contains('toggle--on');
    if (!isGlobalCompareMode && !isCacheSelected && compareMode) {
      compareMode = false;
      toggle.classList.toggle('toggle--on', compareMode);
      toggle.classList.toggle('toggle--off', !compareMode);
      // updateCanvasLayout() will be called by the caller if needed, 
      // but let's call it here just in case, or rely on caller.
      // Calling it here is safe.
      updateCanvasLayout();
    }
  }

  window.addEventListener('compare-mode:toggle', () => {
    checkSliderAutoOff();
  });
  
  // Initial layout state
  updateCanvasLayout();

  main.appendChild(splitView);

  // Variables for layer preview
  let currentSourceCanvas: HTMLCanvasElement | null = null;
  let currentResultCanvas: HTMLCanvasElement | null = null;
  let psdWidth = 0;
  let psdHeight = 0;
  let currentPsd: any = null;

  function renderComposite(ctx: CanvasRenderingContext2D) {
    if (!currentPsd) return;
    
    // Clear the canvas to transparent before drawing
    ctx.clearRect(0, 0, psdWidth, psdHeight);

    function drawLayers(layers: any[]) {
      // ag-psd returns layers from top to bottom, so we iterate backwards to draw bottom-up
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        if (layer.hidden) continue;

        if (layer.children) {
          drawLayers(layer.children);
        } else if (layer.canvas) {
          // Simply draw the layer at its original coordinates
          ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
        }
      }
    }

    if (currentPsd.children) {
      drawLayers(currentPsd.children);
    }
  }

  // Listen for PSD loaded event to render the image
  window.addEventListener('document:loaded', (e: Event) => {
    const customEvent = e as CustomEvent<{ psd: any; filename: string }>;
    const psd = customEvent.detail.psd;
    currentPsd = psd;

    if (psd.width && psd.height) {
      // Clear dummy backgrounds
      sourcePanel.style.backgroundImage = 'none';
      resultPanel.style.backgroundImage = 'none';

      // Remove any previously appended canvas elements
      sourcePanel.querySelectorAll('canvas').forEach(c => c.remove());
      resultPanel.querySelectorAll('canvas').forEach(c => c.remove());

      psdWidth = psd.width;
      psdHeight = psd.height;

      currentSourceCanvas = document.createElement('canvas');
      currentSourceCanvas.width = psdWidth;
      currentSourceCanvas.height = psdHeight;
      const ctxSource = currentSourceCanvas.getContext('2d');
      if (ctxSource) renderComposite(ctxSource);

      currentResultCanvas = document.createElement('canvas');
      currentResultCanvas.width = psdWidth;
      currentResultCanvas.height = psdHeight;
      const ctxResult = currentResultCanvas.getContext('2d');
      if (ctxResult) renderComposite(ctxResult);

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

      styleCanvas(currentSourceCanvas);
      styleCanvas(currentResultCanvas);
      
      // The panels need to be relative for absolute positioning of children
      sourcePanel.style.position = 'relative';
      resultPanel.style.position = 'relative';

      sourcePanel.appendChild(currentSourceCanvas);
      resultPanel.appendChild(currentResultCanvas);
    }
  });

  window.addEventListener('document:redraw', () => {
    if (!currentSourceCanvas || !currentResultCanvas) return;
    
    const ctxSource = currentSourceCanvas.getContext('2d');
    if (ctxSource) renderComposite(ctxSource);

    const ctxResult = currentResultCanvas.getContext('2d');
    if (ctxResult) renderComposite(ctxResult);
  });

  // Keep layer:selected listener just in case other features want to use it
  window.addEventListener('layer:selected', (e: Event) => {
    // Currently doing nothing on the canvas itself, 
    // as we want to always show the composite view.
  });

  window.addEventListener('tool:result-ready', async (e: Event) => {
    const customEvent = e as CustomEvent<{ key: string, toolName: string }>;
    const blob = await getImageCache(customEvent.detail.key);
    if (blob) {
      const url = URL.createObjectURL(blob);
      resultPanel.style.backgroundImage = `url('${url}')`;
      
      if (currentResultCanvas) {
        currentResultCanvas.style.display = 'none';
      }
      
      isCacheSelected = true;
      updateCanvasLayout();
    }
  });

  window.addEventListener('tool:result-cleared', () => {
    resultPanel.style.backgroundImage = 'none';
    if (currentResultCanvas) {
      currentResultCanvas.style.display = 'block';
    }
    
    isCacheSelected = false;
    checkSliderAutoOff();
    updateCanvasLayout();
  });

  window.addEventListener('tool:result-ready:right', async (e: Event) => {
    const customEvent = e as CustomEvent<{ key: string, toolName: string }>;
    const blob = await getImageCache(customEvent.detail.key);
    if (blob) {
      const url = URL.createObjectURL(blob);
      resultPanel.style.backgroundImage = `url('${url}')`;
      
      if (currentResultCanvas) {
        currentResultCanvas.style.display = 'none';
      }
      
      isCacheSelected = true;
      updateCanvasLayout();
    }
  });

  window.addEventListener('tool:result-cleared:right', () => {
    resultPanel.style.backgroundImage = 'none';
    if (currentResultCanvas) {
      currentResultCanvas.style.display = 'block';
    }
    
    // If left sidebar still has a cache selected, we might want to preserve isCacheSelected, 
    // but typically right sidebar controls the result panel in compare mode.
    // We will just clear it.
    isCacheSelected = false;
    checkSliderAutoOff();
    updateCanvasLayout();
  });

  return main;
}
