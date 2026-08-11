/**
 * Confeito-Studio — Application Entry Point
 *
 * Assembles the toolbar, grid layout, and all panels
 * into the main application shell.
 */

import './shared/styles/variables.css';
import './shared/styles/base.css';
import './shared/styles/layout.css';

import { createTopBar } from './features/top-bar/TopBar';
import { createLayerPanel } from './features/layer-panel/LayerPanel';
import { createCanvas } from './features/canvas/Canvas';
import { createAIPanel } from './features/ai-panel/AIPanel';
import { createStatusBar } from './features/status-bar/StatusBar';
import { initDocumentManager } from './features/document/DocumentManager';

function initApp(): void {
  const app = document.getElementById('app');
  if (!app) return;

  // Main workspace grid
  const workspace = document.createElement('div');
  workspace.className = 'manga-grid';

  const leftSidebar = createLayerPanel({ panelType: 'left' });
  const canvas = createCanvas();
  const aiPanel = createAIPanel();
  let rightSidebar = aiPanel;

  // Grid children in order: topbar (row 1 full), layers (row 2 col 1),
  // canvas (row 2 col 2), ai-panel (row 2 col 3), statusbar (row 3 full)
  workspace.appendChild(createTopBar());
  workspace.appendChild(leftSidebar);
  workspace.appendChild(canvas);
  workspace.appendChild(rightSidebar);
  workspace.appendChild(createStatusBar());

  // Listen for Compare Mode toggle to swap the right sidebar
  window.addEventListener('compare-mode:toggle', (e: Event) => {
    const isCompareMode = (e as CustomEvent).detail.enabled;
    if (isCompareMode) {
      const leftState = (leftSidebar as any).getUIState ? (leftSidebar as any).getUIState() : undefined;
      const compareSidebar = createLayerPanel({ panelType: 'right', isCompareMode: true, initialState: leftState });
      workspace.replaceChild(compareSidebar, rightSidebar);
      rightSidebar = compareSidebar;
    } else {
      workspace.replaceChild(aiPanel, rightSidebar);
      rightSidebar = aiPanel;
    }
  });

  app.appendChild(workspace);

  // Initialize global managers after UI is fully built
  initDocumentManager();
}

document.addEventListener('DOMContentLoaded', initApp);
