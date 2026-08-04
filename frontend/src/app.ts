/**
 * Confeito-Studio — Application Entry Point
 *
 * Assembles the toolbar, grid layout, and all panels
 * into the main application shell.
 */

import './shared/styles/variables.css';
import './shared/styles/base.css';
import './shared/styles/layout.css';

import { createToolbar } from './features/toolbar/Toolbar';
import { createTopBar } from './features/top-bar/TopBar';
import { createLayerPanel } from './features/layer-panel/LayerPanel';
import { createCanvas } from './features/canvas/Canvas';
import { createAIPanel } from './features/ai-panel/AIPanel';
import { createStatusBar } from './features/status-bar/StatusBar';
import { initDocumentManager } from './features/document/DocumentManager';

function initApp(): void {
  const app = document.getElementById('app');
  if (!app) return;

  // Left toolbar rail (outside the grid)
  app.appendChild(createToolbar());

  // Main workspace grid
  const workspace = document.createElement('div');
  workspace.className = 'manga-grid';

  // Grid children in order: topbar (row 1 full), layers (row 2 col 1),
  // canvas (row 2 col 2), ai-panel (row 2 col 3), statusbar (row 3 full)
  workspace.appendChild(createTopBar());
  workspace.appendChild(createLayerPanel());
  workspace.appendChild(createCanvas());
  workspace.appendChild(createAIPanel());
  workspace.appendChild(createStatusBar());

  app.appendChild(workspace);

  // Initialize global managers after UI is fully built
  initDocumentManager();
}

document.addEventListener('DOMContentLoaded', initApp);
