/**
 * Application entry point.
 *
 * Waits for the backend (/api/health) behind the splash screen, loads tool settings,
 * then builds the shell grid: TopBar / ToolBar / ARCHIVES / Canvas / AI panel / StatusBar.
 * In Compare mode the AI panel is swapped for a second ARCHIVES panel.
 */
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import 'material-symbols/outlined.css';

import './shared/styles/variables.css';
import './shared/styles/base.css';
import './shared/styles/components.css';
import './shared/styles/layout.css';

import { createAIPanel } from './features/ai-panel/AIPanel';
import { type ArchivePanel, createArchivePanel } from './features/archive-panel/ArchivePanel';
import { createCanvas } from './features/canvas/Canvas';
import { createStatusBar } from './features/status-bar/StatusBar';
import { createToolBar } from './features/tool-bar/ToolBar';
import { createTopBar } from './features/top-bar/TopBar';
import { isBackendHealthy } from './shared/api/system';
import { on } from './shared/events';
import { initializeSettings } from './shared/state/tool-settings';

const HEALTH_POLL_MS = 1000;

async function waitForBackend(): Promise<void> {
  while (!(await isBackendHealthy())) {
    await new Promise(resolve => setTimeout(resolve, HEALTH_POLL_MS));
  }
}

function hideSplash(): void {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;
  splash.style.opacity = '0';
  setTimeout(() => splash.remove(), 300);
}

async function initApp(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  await waitForBackend();
  hideSplash();
  await initializeSettings();

  const workspace = document.createElement('div');
  workspace.className = 'manga-grid';

  const archives = createArchivePanel({ side: 'left' });
  const aiPanel = createAIPanel();
  let comparePanel: ArchivePanel | null = null;

  // Grid order: topbar (row 1), toolbar | archives | canvas | right sidebar (row 2), statusbar (row 3)
  workspace.append(createTopBar(), createToolBar(), archives.el, createCanvas(), aiPanel, createStatusBar());

  on('compare-mode:toggle', ({ enabled }) => {
    if (enabled) {
      comparePanel = createArchivePanel({ side: 'right', initialState: archives.getSelectionState() });
      aiPanel.replaceWith(comparePanel.el);
    } else if (comparePanel) {
      comparePanel.destroy();
      comparePanel.el.replaceWith(aiPanel);
      comparePanel = null;
    }
  });

  app.appendChild(workspace);
}

document.addEventListener('DOMContentLoaded', () => void initApp());
