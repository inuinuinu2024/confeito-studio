/**
 * Application entry point.
 *
 * Waits for the backend (/api/health) behind the splash screen, loads tool settings,
 * then builds the shell grid: TopBar / ToolBar / main area / AI panel / StatusBar.
 * The main area is the flow canvas in Normal mode (images are compared in a window opened from it). The managers
 * (Prompt Manager, Character Manager) put their own sidebar and main area there, the Archive Manager its list and
 * the Cost Monitor its dashboard.
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
import { createArchiveManager } from './features/archive-manager/ArchiveManager';
import { createCharacterManager } from './features/character-manager/CharacterManager';
import { createCostMonitor } from './features/cost-monitor/CostMonitor';
import { createFlowCanvas } from './features/flow-canvas/FlowCanvas';
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

  // The managers and the Cost Monitor have no tools: no right sidebar; the managers add their sidebar column.
  // Registered before the features so their mode handlers measure the resized area. The mode is read from the
  // store: switching between two modes emits one mode's "on" before the other's "off".
  const syncLayout = () => {
    const mode = getViewMode();
    workspace.classList.toggle('manga-grid--no-tools', ['archive', 'prompt', 'character', 'cost'].includes(mode));
    workspace.classList.toggle('manga-grid--manager', ['archive', 'prompt', 'character', 'cost'].includes(mode));
    workspace.classList.toggle('manga-grid--archive', mode === 'archive');
    workspace.classList.toggle('manga-grid--prompt', mode === 'prompt');
    workspace.classList.toggle('manga-grid--character', mode === 'character');
    workspace.classList.toggle('manga-grid--cost', mode === 'cost');
  };
  for (const event of [
    'normal-mode:toggle',
    'archive-mode:toggle',
    'prompt-mode:toggle',
    'character-mode:toggle',
    'cost-mode:toggle',
  ] as const) {
    on(event, syncLayout);
  }
  const promptManager = createPromptManager();
  const characterManager = createCharacterManager();

  // Grid order: topbar (row 1), toolbar | main area | right sidebar (row 2), statusbar (row 3).
  // Each manager's two parts place themselves in the sidebar / main cells (hidden outside its mode).
  workspace.append(
    createTopBar(),
    createToolBar(),
    createFlowCanvas(),
    createAIPanel(),
    createStatusBar(),
    promptManager.sidebar,
    promptManager.main,
    characterManager.sidebar,
    characterManager.main,
    createArchiveManager(),
    createCostMonitor(),
  );

  app.appendChild(workspace);
}

document.addEventListener('DOMContentLoaded', () => void initApp());
