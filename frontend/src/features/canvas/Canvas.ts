/**
 * Canvas — Central workspace with split compare view and floating toolbar.
 */
import { icon } from '../../shared/utils/dom';
import { getImageCache } from '../../shared/utils/idb';
import { showToast } from '../../shared/utils/toast';

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

  let isGlobalCompareMode = false;

  const compareModeToggle = document.createElement('div');
  compareModeToggle.className = 'toggle toggle--off';
  const compareModeKnob = document.createElement('div');
  compareModeKnob.className = 'toggle__knob';
  compareModeToggle.appendChild(compareModeKnob);
  
  compareModeToggle.addEventListener('click', () => {
    isGlobalCompareMode = !isGlobalCompareMode;
    compareModeToggle.classList.toggle('toggle--on', isGlobalCompareMode);
    compareModeToggle.classList.toggle('toggle--off', !isGlobalCompareMode);
    
    if (isGlobalCompareMode) {
      rightSelectedLayer = leftSelectedLayer;
      rightHiddenLayers = new Set(leftHiddenLayers);
      rightCacheUrl = leftCacheUrl;
      
      if (currentResultCanvas) {
        const ctx = currentResultCanvas.getContext('2d');
        if (ctx) renderSideContext(ctx, rightSelectedLayer, rightHiddenLayers);
      }
    }

    window.dispatchEvent(new CustomEvent('compare-mode:toggle', { detail: { enabled: isGlobalCompareMode } }));
    updateCanvasLayout();
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
  toggle.className = 'toggle toggle--off';
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
  sourcePanel.style.backgroundImage = 'none';
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
  resultPanel.style.backgroundImage = 'none';
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

  let isSliderMode = false;
  let splitPct = 50;

  let leftCacheUrl = '';
  let rightCacheUrl = '';

  const leftCacheOverlay = document.createElement('div');
  const rightCacheOverlay = document.createElement('div');
  const leftTextOverlay = document.createElement('div');
  const rightTextOverlay = document.createElement('div');

  let currentBgColor = 'transparent';

  function styleOverlay(overlay: HTMLDivElement) {
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundSize = 'contain';
    overlay.style.backgroundPosition = 'center';
    overlay.style.backgroundRepeat = 'no-repeat';
    overlay.style.zIndex = '1';
    overlay.style.pointerEvents = 'none';
  }
  
  styleOverlay(leftCacheOverlay);
  styleOverlay(rightCacheOverlay);

  function styleTextOverlay(overlay: HTMLDivElement) {
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.zIndex = '2';
    overlay.style.backgroundColor = 'var(--color-surface-container)';
    overlay.style.color = 'var(--color-on-surface)';
    overlay.style.padding = '16px';
    overlay.style.overflow = 'auto';
    overlay.style.whiteSpace = 'pre-wrap';
    overlay.style.fontFamily = 'monospace';
    overlay.style.fontSize = '12px';
    overlay.style.display = 'none';
  }
  
  styleTextOverlay(leftTextOverlay);
  styleTextOverlay(rightTextOverlay);

  function updateCanvasLayout() {
    compareGroup.style.display = 'flex';
    
    const hasLeftCache = leftCacheUrl !== '';
    const showTwoPanes = isGlobalCompareMode || (!isGlobalCompareMode && hasLeftCache);

    if (showTwoPanes) {
      resultPanel.style.display = '';
      
      if (isSliderMode) {
        splitDivider.style.display = 'flex';
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
        splitDivider.style.display = 'none';
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
      splitViewInner.style.gap = '0';
      
      sourcePanel.style.flex = '1';
      sourcePanel.style.position = 'relative';
      sourcePanel.style.width = 'auto';
      sourcePanel.style.height = 'auto';
      sourcePanel.style.zIndex = '';
      sourcePanel.style.clipPath = 'none';
    }

    if (isGlobalCompareMode) {
      leftCacheOverlay.style.backgroundImage = leftCacheUrl ? `url('${leftCacheUrl}')` : 'none';
      rightCacheOverlay.style.backgroundImage = rightCacheUrl ? `url('${rightCacheUrl}')` : 'none';
    } else {
      if (hasLeftCache) {
        leftCacheOverlay.style.backgroundImage = 'none';
        rightCacheOverlay.style.backgroundImage = leftCacheUrl ? `url('${leftCacheUrl}')` : 'none';
      } else {
        leftCacheOverlay.style.backgroundImage = 'none';
        rightCacheOverlay.style.backgroundImage = 'none';
      }
    }
  }

  toggle.addEventListener('click', () => {
    if (!isGlobalCompareMode && leftCacheUrl === '') {
      showToast('比較するキャッシュが選択されていません', 'error');
      return;
    }

    isSliderMode = !isSliderMode;
    toggle.classList.toggle('toggle--on', isSliderMode);
    toggle.classList.toggle('toggle--off', !isSliderMode);
    updateCanvasLayout();
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

  let leftSelectedLayer: any = null;
  let rightSelectedLayer: any = null;

  let leftHiddenLayers = new Set<any>();
  let rightHiddenLayers = new Set<any>();

  function drawNode(ctx: CanvasRenderingContext2D, node: any, hiddenLayers: Set<any>) {
    if (hiddenLayers.has(node)) return;
    if (node.children) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        drawNode(ctx, node.children[i], hiddenLayers);
      }
    } else if (node.canvas) {
      ctx.drawImage(node.canvas, node.left || 0, node.top || 0);
    }
  }

  function renderSideContext(ctx: CanvasRenderingContext2D, selectedLayer: any, hiddenLayers: Set<any>) {
    if (!currentPsd) return;
    
    if (currentBgColor && currentBgColor !== 'transparent') {
      ctx.fillStyle = currentBgColor;
      ctx.fillRect(0, 0, psdWidth, psdHeight);
    } else {
      ctx.clearRect(0, 0, psdWidth, psdHeight);
    }

    if (currentPsd.children) {
      for (let i = currentPsd.children.length - 1; i >= 0; i--) {
        drawNode(ctx, currentPsd.children[i], hiddenLayers);
      }
    }
  }

  // Listen for PSD loaded event to render the image
  window.addEventListener('document:loaded', (e: Event) => {
    const customEvent = e as CustomEvent<{ psd: any; filename: string }>;
    const psd = customEvent.detail.psd;
    currentPsd = psd;
    leftSelectedLayer = null;
    rightSelectedLayer = null;

    if (psd.width && psd.height) {
      sourcePanel.style.backgroundImage = 'none';
      resultPanel.style.backgroundImage = 'none';

      sourcePanel.innerHTML = '';
      resultPanel.innerHTML = '';

      psdWidth = psd.width;
      psdHeight = psd.height;

      currentSourceCanvas = document.createElement('canvas');
      currentSourceCanvas.width = psdWidth;
      currentSourceCanvas.height = psdHeight;
      const ctxSource = currentSourceCanvas.getContext('2d');
      if (ctxSource) renderSideContext(ctxSource, leftSelectedLayer, leftHiddenLayers);

      currentResultCanvas = document.createElement('canvas');
      currentResultCanvas.width = psdWidth;
      currentResultCanvas.height = psdHeight;
      const ctxResult = currentResultCanvas.getContext('2d');
      if (ctxResult) renderSideContext(ctxResult, rightSelectedLayer, rightHiddenLayers);

      const styleCanvas = (c: HTMLCanvasElement) => {
        c.style.width = '100%';
        c.style.height = '100%';
        c.style.objectFit = 'contain';
        c.style.position = 'absolute';
        c.style.top = '0';
        c.style.left = '0';
        c.style.zIndex = '0';
      };

      styleCanvas(currentSourceCanvas);
      styleCanvas(currentResultCanvas);
      
      styleOverlay(leftCacheOverlay);
      styleOverlay(rightCacheOverlay);
      
      sourcePanel.style.position = 'relative';
      resultPanel.style.position = 'relative';

      sourcePanel.appendChild(currentSourceCanvas);
      sourcePanel.appendChild(leftCacheOverlay);
      sourcePanel.appendChild(leftTextOverlay);
      
      resultPanel.appendChild(currentResultCanvas);
      resultPanel.appendChild(rightCacheOverlay);
      resultPanel.appendChild(rightTextOverlay);
    }
  });

  window.addEventListener('document:closed', () => {
    currentPsd = null;
    leftSelectedLayer = null;
    rightSelectedLayer = null;
    currentSourceCanvas = null;
    currentResultCanvas = null;
    
    sourcePanel.style.backgroundImage = 'none';
    resultPanel.style.backgroundImage = 'none';
    
    sourcePanel.innerHTML = '';
    resultPanel.innerHTML = '';
  });

  window.addEventListener('document:redraw', () => {
    if (!isGlobalCompareMode) {
      rightSelectedLayer = leftSelectedLayer;
      rightHiddenLayers = new Set(leftHiddenLayers);
    }
    
    if (currentSourceCanvas) {
      const ctx = currentSourceCanvas.getContext('2d');
      if (ctx) renderSideContext(ctx, leftSelectedLayer, leftHiddenLayers);
    }
    if (currentResultCanvas) {
      const ctx = currentResultCanvas.getContext('2d');
      if (ctx) renderSideContext(ctx, rightSelectedLayer, rightHiddenLayers);
    }
  });

  window.addEventListener('layer:selected', async (e: Event) => {
    const customEvent = e as CustomEvent<{ layer: any }>;
    leftSelectedLayer = customEvent.detail.layer;
    if (leftSelectedLayer && leftSelectedLayer.fileBlob) {
      const text = await leftSelectedLayer.fileBlob.text();
      leftTextOverlay.textContent = text;
      leftTextOverlay.style.display = 'block';
    } else {
      leftTextOverlay.style.display = 'none';
    }
    if (currentSourceCanvas) {
      const ctx = currentSourceCanvas.getContext('2d');
      if (ctx) renderSideContext(ctx, leftSelectedLayer, leftHiddenLayers);
    }
  });
  
  window.addEventListener('layer:selected:right', async (e: Event) => {
    const customEvent = e as CustomEvent<{ layer: any }>;
    rightSelectedLayer = customEvent.detail.layer;
    if (rightSelectedLayer && rightSelectedLayer.fileBlob) {
      const text = await rightSelectedLayer.fileBlob.text();
      rightTextOverlay.textContent = text;
      rightTextOverlay.style.display = 'block';
    } else {
      rightTextOverlay.style.display = 'none';
    }
    if (currentResultCanvas) {
      const ctx = currentResultCanvas.getContext('2d');
      if (ctx) renderSideContext(ctx, rightSelectedLayer, rightHiddenLayers);
    }
  });

  window.addEventListener('layer:visibility', (e: Event) => {
    const customEvent = e as CustomEvent<{ hiddenLayers: Set<any> }>;
    leftHiddenLayers = customEvent.detail.hiddenLayers;
  });

  window.addEventListener('layer:visibility:right', (e: Event) => {
    const customEvent = e as CustomEvent<{ hiddenLayers: Set<any> }>;
    rightHiddenLayers = customEvent.detail.hiddenLayers;
  });

  window.addEventListener('tool:result-ready', async (e: Event) => {
    const customEvent = e as CustomEvent<{ key: string, toolName: string }>;
    const blob = await getImageCache(customEvent.detail.key);
    if (blob) {
      if (customEvent.detail.toolName.match(/\.(json|txt|md)$/i) || blob.type.startsWith('text/') || blob.type === 'application/json') {
        const text = await blob.text();
        leftTextOverlay.textContent = text;
        leftTextOverlay.style.display = 'block';
        leftCacheUrl = '';
      } else {
        leftTextOverlay.style.display = 'none';
        leftCacheUrl = URL.createObjectURL(blob);
      }
      updateCanvasLayout();
    }
  });

  window.addEventListener('tool:result-cleared', () => {
    leftCacheUrl = '';
    leftTextOverlay.style.display = 'none';
    if (!isGlobalCompareMode && isSliderMode) {
      isSliderMode = false;
      toggle.classList.add('toggle--off');
      toggle.classList.remove('toggle--on');
    }
    updateCanvasLayout();
  });

  window.addEventListener('tool:result-ready:right', async (e: Event) => {
    const customEvent = e as CustomEvent<{ key: string, toolName: string }>;
    const blob = await getImageCache(customEvent.detail.key);
    if (blob) {
      if (customEvent.detail.toolName.match(/\.(json|txt|md)$/i) || blob.type.startsWith('text/') || blob.type === 'application/json') {
        const text = await blob.text();
        rightTextOverlay.textContent = text;
        rightTextOverlay.style.display = 'block';
        rightCacheUrl = '';
      } else {
        rightTextOverlay.style.display = 'none';
        rightCacheUrl = URL.createObjectURL(blob);
      }
      updateCanvasLayout();
    }
  });

  window.addEventListener('tool:result-cleared:right', () => {
    rightCacheUrl = '';
    rightTextOverlay.style.display = 'none';
    updateCanvasLayout();
  });

  window.addEventListener('canvas:bg-color', (e: Event) => {
    const customEvent = e as CustomEvent<{ color: string }>;
    currentBgColor = customEvent.detail.color;
    window.dispatchEvent(new CustomEvent('document:redraw'));
  });

  return main;
}
