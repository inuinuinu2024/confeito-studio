/**
 * Application entry point.
 *
 * Waits for the backend (/api/health) behind the splash screen, loads tool settings,
 * then builds the shell grid: TopBar / ToolBar / ARCHIVES / Canvas / AI panel / StatusBar.
 * Parallel and Overlay mode hide the AI panel (they only compare images); the Prompt Manager mode
 * also replaces ARCHIVES and the canvas with its own sidebar and main area.
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
import { createArchivePanel } from './features/archive-panel/ArchivePanel';
import { createCanvas } from './features/canvas/Canvas';
import { createPromptManager } from './features/prompt-manager/PromptManager';
import { createStatusBar } from './features/status-bar/StatusBar';
import { createToolBar } from './features/tool-bar/ToolBar';
import { createTopBar } from './features/top-bar/TopBar';
import { isBackendHealthy } from './shared/api/system';
import { on } from './shared/events';
import { loadSettings } from './shared/state/tool-settings';
import { getViewMode } from './shared/state/view-mode';

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
  await loadSettings();

  const workspace = document.createElement('div');
  workspace.className = 'manga-grid';

  // Parallel / Overlay mode only compare images: no tools, the canvas gets the right sidebar's width.
  // The Prompt Manager has no tools either and covers ARCHIVES and the canvas.
  // Registered before the canvas so its mode handlers measure the resized area. The mode is read from the
  // store: switching between two modes emits one mode's "on" before the other's "off".
  const syncLayout = () => {
    const mode = getViewMode();
    workspace.classList.toggle('manga-grid--no-tools', ['parallel', 'overlay', 'prompt'].includes(mode));
    workspace.classList.toggle('manga-grid--prompt', mode === 'prompt');
  };
  for (const event of ['parallel-mode:toggle', 'overlay-mode:toggle', 'prompt-mode:toggle'] as const) {
    on(event, syncLayout);
  }
  const promptManager = createPromptManager();

  // Grid order: topbar (row 1), toolbar | archives | canvas | right sidebar (row 2), statusbar (row 3).
  // The Prompt Manager's two parts place themselves in the archives / canvas cells (hidden outside its mode).
  workspace.append(
    createTopBar(),
    createToolBar(),
    createArchivePanel(),
    createCanvas(),
    createAIPanel(),
    createStatusBar(),
    promptManager.sidebar,
    promptManager.main,
  );

  app.appendChild(workspace);
}

document.addEventListener('DOMContentLoaded', () => void initApp());
