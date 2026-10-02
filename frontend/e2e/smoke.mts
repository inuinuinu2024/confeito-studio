/**
 * E2E smoke test for Confeito-Studio.
 *
 * Boots the backend (uvicorn) and the Vite dev server against an isolated temporary
 * data directory, drives the real UI in headless Edge/Chrome, and writes:
 *   <out>/observations.json  structured UI state per scenario (diff it between runs)
 *   <out>/NN-*.png           screenshots per scenario
 *   <out>/backend.log, <out>/vite.log
 *
 * Usage (from frontend/):
 *   npm run e2e
 *   node e2e/smoke.mts --headed --out e2e/.output/manual
 *
 * Options:
 *   --root <dir>          repository root to run (default: this repository)
 *   --python <exe>        python that has the backend deps (default: <root>/backend/.venv)
 *   --backend-port <n>    default 48100 (keeps clear of a running app on 48000)
 *   --frontend-port <n>   default 45273
 *   --out <dir>           default e2e/.output/latest
 *   --headed              show the browser window
 *   --keep                keep the temporary data directory
 *
 * The run never calls external APIs (Gemini) and never touches the real archives/ directory.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';

const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface Options {
  root: string;
  python: string;
  backendPort: number;
  frontendPort: number;
  out: string;
  headed: boolean;
  keep: boolean;
}

function parseArgs(argv: string[]): Options {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = path.resolve(get('--root') ?? path.join(FRONTEND_DIR, '..'));
  const venvPython =
    process.platform === 'win32'
      ? path.join(root, 'backend', '.venv', 'Scripts', 'python.exe')
      : path.join(root, 'backend', '.venv', 'bin', 'python');
  return {
    root,
    python: path.resolve(get('--python') ?? venvPython),
    backendPort: Number(get('--backend-port') ?? 48100),
    frontendPort: Number(get('--frontend-port') ?? 45273),
    out: path.resolve(get('--out') ?? path.join(FRONTEND_DIR, 'e2e', '.output', 'latest')),
    headed: argv.includes('--headed'),
    keep: argv.includes('--keep'),
  };
}

// ── Process management ────────────────────────────────────────────────

function startProcess(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  logFile: string,
): ChildProcess {
  const log = fs.openSync(logFile, 'w');
  return spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', log, log],
    windowsHide: true,
  });
}

function killTree(child: ChildProcess | undefined): void {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

async function waitForHttp(url: string, timeoutMs: number, proc: ChildProcess, name: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`${name} exited early (code ${proc.exitCode})`);
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`${name} did not respond at ${url} within ${timeoutMs}ms`);
}

async function launchBrowser(headed: boolean): Promise<Browser> {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: !headed });
    } catch {
      // try next channel
    }
  }
  throw new Error('Neither Microsoft Edge nor Google Chrome could be launched.');
}

// ── Page helpers ──────────────────────────────────────────────────────

const LEFT_PANEL = 'aside.layer-panel:not(.layer-panel--right)';
const RIGHT_PANEL = 'aside.layer-panel--right';

/** Masks timestamps so observations are comparable across runs. */
function maskTimestamps(value: string): string {
  return value.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, '<DATETIME>').replace(/\d{8}_\d{6}/g, '<STAMP>');
}

async function archiveTree(page: Page, panel = LEFT_PANEL) {
  const rows = await page.$$eval(`${panel} .layer-item`, els =>
    els.map(el => ({
      name: el.querySelector('.layer-item__name')?.textContent ?? '',
      indent: (el as HTMLElement).style.paddingLeft,
      state: ['layer-item--group', 'layer-item--selected', 'layer-item--active']
        .filter(c => el.classList.contains(c))
        .map(c => c.replace('layer-item--', '')),
    })),
  );
  return rows.map(r => ({ ...r, name: maskTimestamps(r.name) }));
}

function archiveItem(page: Page, name: string | RegExp, panel = LEFT_PANEL) {
  return page
    .locator(`${panel} .layer-item`)
    .filter({
      has: page.locator('.layer-item__name', { hasText: name }),
    })
    .first();
}

/** Row `child` directly under the top-level archive `parent` (the archive must be expanded). */
async function childItem(page: Page, parent: string, child: string, panel = LEFT_PANEL) {
  const index = await page.$$eval(
    `${panel} .layer-item`,
    (els, [parent, child]) => {
      let inParent = false;
      for (let i = 0; i < els.length; i++) {
        const name = els[i].querySelector('.layer-item__name')?.textContent;
        if ((els[i] as HTMLElement).style.paddingLeft === '8px') inParent = name === parent;
        else if (inParent && name === child) return i;
      }
      return -1;
    },
    [parent, child],
  );
  if (index < 0) throw new Error(`${parent}/${child} not found in the ARCHIVES tree`);
  return page.locator(`${panel} .layer-item`).nth(index);
}

async function expandFolder(page: Page, name: string | RegExp, panel = LEFT_PANEL): Promise<void> {
  const row = archiveItem(page, name, panel);
  const chevron = row.locator('.layer-item__icon--chevron');
  if ((await chevron.textContent()) === 'chevron_right') {
    await chevron.click();
    await page.waitForFunction(
      ({ panel, source }) =>
        Array.from(document.querySelectorAll(`${panel} .layer-item`)).some(
          el =>
            new RegExp(source).test(el.querySelector('.layer-item__name')?.textContent ?? '') &&
            el.querySelector('.layer-item__icon--chevron')?.textContent === 'expand_more',
        ),
      { panel, source: typeof name === 'string' ? name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : name.source },
    );
  }
}

async function canvasState(page: Page) {
  return page
    .evaluate(() => {
      const visible = (el: Element | null) => !!el && (el as HTMLElement).getClientRects().length > 0;
      const sample = (c: HTMLCanvasElement) => {
        if (!c.width || !c.height) return [];
        const ctx = c.getContext('2d');
        if (!ctx) return [];
        const coords: [number, number][] = [
          [2, 2],
          [c.width - 3, 2],
          [2, c.height - 3],
          [c.width - 3, c.height - 3],
        ];
        for (let gy = 0; gy < 5; gy++) {
          for (let gx = 0; gx < 5; gx++) {
            coords.push([Math.floor(((gx + 0.5) / 5) * c.width), Math.floor(((gy + 0.5) / 5) * c.height)]);
          }
        }
        return coords.map(([x, y]) => {
          const [r, g, b, a] = ctx.getImageData(Math.min(c.width - 1, x), Math.min(c.height - 1, y), 1, 1).data;
          return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
        });
      };
      const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>('.canvas-area canvas'));
      const zoomBar = document.querySelector<HTMLElement>('.canvas-zoom-bar');
      const toolbar = document.querySelector<HTMLElement>('.canvas-toolbar');
      return {
        canvases: canvases.map(c => ({
          w: c.width,
          h: c.height,
          visible: visible(c),
          title: c.title,
          pixels: sample(c),
        })),
        zoomLabel: document.querySelector('.canvas-zoom-bar__label')?.textContent ?? null,
        zoomBarVisible: visible(zoomBar),
        toolbarVisible: visible(toolbar),
        toolbarGroupsVisible: Array.from(document.querySelectorAll('.canvas-toolbar__compare')).map(visible),
        textOverlays: Array.from(document.querySelectorAll<HTMLElement>('.canvas-text-overlay')).map(o => ({
          visible: visible(o),
          text: (o.textContent ?? '').slice(0, 300),
        })),
      };
    })
    .then(s => ({
      ...s,
      textOverlays: s.textOverlays.map(o => ({ ...o, text: maskTimestamps(o.text) })),
    }));
}

async function sidebarState(page: Page) {
  return page.evaluate(() => {
    const sb = document.querySelector<HTMLElement>('.tool-settings-sidebar');
    if (!sb || !document.body.contains(sb)) return null;
    const shown = (el: Element) => el.getClientRects().length > 0;
    return {
      title: sb.querySelector('h2')?.textContent ?? null,
      labels: Array.from(sb.querySelectorAll('label'))
        .filter(shown)
        .map(l => l.textContent?.trim()),
      buttons: Array.from(sb.querySelectorAll('button'))
        .filter(shown)
        .map(b => b.textContent?.trim()),
      selects: Array.from(sb.querySelectorAll('select')).map(s => ({
        value: s.value,
        options: Array.from(s.options).map(o => o.textContent),
      })),
      ranges: Array.from(sb.querySelectorAll<HTMLInputElement>('input[type=range]')).map(r => r.value),
      textareas: Array.from(sb.querySelectorAll('textarea')).map(t => t.value.slice(0, 40)),
    };
  });
}

async function lastToast(page: Page): Promise<string | null> {
  const text = await page.evaluate(() => {
    const toasts = document.querySelectorAll('.toast');
    return toasts.length ? toasts[toasts.length - 1].textContent : null;
  });
  return text === null ? null : maskTimestamps(text);
}

async function waitForToast(page: Page, pattern: RegExp, timeout = 20000): Promise<string> {
  await page.waitForFunction(
    source => Array.from(document.querySelectorAll('.toast')).some(t => new RegExp(source).test(t.textContent ?? '')),
    pattern.source,
    { timeout },
  );
  return (await lastToast(page)) ?? '';
}

/** Creates a deterministic PNG in the page (with a transparent margin so background colour shows). */
async function dropTestImage(page: Page, fileName: string, width: number, height: number): Promise<void> {
  await page.evaluate(
    async ({ fileName, width, height }) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#3366cc';
      ctx.fillRect(40, 40, width - 80, height - 80);
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, Math.min(width, height) / 4, 0, Math.PI * 2);
      ctx.fill();
      const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], fileName, { type: 'image/png' }));
      document
        .querySelector('.canvas-area')!
        .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    { fileName, width, height },
  );
}

/** Writes a panel-split style folder (two panels + panels.json) through the archive API. */
async function createPanelFixture(page: Page, apiBase: string): Promise<void> {
  await page.evaluate(async apiBase => {
    const panel = async (color: string) => {
      const c = document.createElement('canvas');
      c.width = 150;
      c.height = 200;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 150, 200);
      return new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'));
    };
    const panelsJson = {
      version: '1.0',
      image_size: { width: 300, height: 200 },
      panels_count: 2,
      panels: [
        { panel_number: 1, filename: '01.png', pixel_box: [0, 0, 150, 200], xywh: [0, 0, 150, 200] },
        { panel_number: 2, filename: '02.png', pixel_box: [150, 0, 300, 200], xywh: [150, 0, 150, 200] },
      ],
    };
    const files: [string, Blob][] = [
      ['sub/01.png', await panel('#cc3333')],
      ['sub/02.png', await panel('#33cc33')],
      ['sub/panels.json', new Blob([JSON.stringify(panelsJson)], { type: 'application/json' })],
      ['log.txt', new Blob(['[fixture] created\n'], { type: 'text/plain' })],
    ];
    const form = new FormData();
    form.append('name', 'e2e-panels');
    for (const [p, blob] of files) {
      form.append('files', blob, p);
      form.append('paths', p);
    }
    const res = await fetch(`${apiBase}/archives`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`fixture upload failed: ${res.status}`);
  }, apiBase);
}

async function clickTool(page: Page, toolName: string): Promise<void> {
  await page
    .locator('.ai-panel__view:visible .ai-tool-btn')
    .filter({ has: page.locator('.ai-tool-name', { hasText: toolName }) })
    .first()
    .click();
}

async function closeSidebar(page: Page): Promise<void> {
  const sb = page.locator('.tool-settings-sidebar');
  if (await sb.count()) {
    await sb.locator('button').first().click();
    await sb.waitFor({ state: 'detached', timeout: 3000 });
  }
}

async function setMode(page: Page, mode: 'Normal' | 'Compare' | 'Overlay' | 'Batch'): Promise<void> {
  await page.locator(`.left-toolbar__btn[title="${mode} Mode"]`).click();
  await page.waitForTimeout(300);
}

// ── Scenarios ─────────────────────────────────────────────────────────

async function runScenarios(page: Page, apiBase: string, out: string, obs: Record<string, unknown>): Promise<void> {
  let shot = 0;
  const screenshot = async (name: string, selector?: string) => {
    shot += 1;
    const file = path.join(out, `${String(shot).padStart(2, '0')}-${name}.png`);
    if (selector) await page.locator(selector).first().screenshot({ path: file });
    else await page.screenshot({ path: file });
  };
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      obs[name] = await fn();
    } catch (err) {
      obs[name] = { error: String(err) };
      console.error(`[e2e] ${name} failed:`, err);
    }
  };

  await step('01-boot', async () => {
    await page.waitForSelector('.manga-grid', { timeout: 120000 });
    await page.waitForSelector('#splash-screen', { state: 'detached', timeout: 10000 });
    await page.waitForTimeout(500);
    await screenshot('boot');
    return {
      menus: await page.$$eval('.topbar__nav-item', els => els.map(e => e.textContent)),
      modes: await page.$$eval('.left-toolbar__btn', els =>
        els.map(e => [e.getAttribute('title'), e.classList.contains('left-toolbar__btn--active')]),
      ),
      tabs: await page.$$eval('.ai-panel__tab', els => els.map(e => e.textContent)),
      tools: await page.$$eval('.ai-panel__view:not([style*="none"]) .ai-tool-name', els =>
        els.map(e => e.textContent),
      ),
      status: await page.$$eval('.statusbar__status-item, .statusbar__left', els => els.map(e => e.textContent)),
      archives: await archiveTree(page),
      canvas: await canvasState(page),
    };
  });

  await step('02-tool-tabs', async () => {
    const tabs = page.locator('.ai-panel__tab');
    await tabs.filter({ hasText: 'Custom' }).click();
    const custom = await page.$$eval('.ai-panel__view:not([style*="none"]) .ai-tool-name', els =>
      els.map(e => e.textContent),
    );
    await tabs.filter({ hasText: 'All Tools' }).click();
    const pinBtn = page
      .locator('.ai-panel__view:visible .ai-tool-row')
      .filter({ has: page.locator('.ai-tool-name', { hasText: 'コマ分割' }) })
      .locator('.ai-tool-action-btn');
    await pinBtn.click();
    const pinnedToast = await lastToast(page);
    const badges = await page.$$eval('.ai-panel__tab-badge', els => els.map(e => e.textContent));
    await pinBtn.click();
    return {
      custom,
      pinnedToast,
      badgesAfterPin: badges,
      badgesAfterUnpin: await page.$$eval('.ai-panel__tab-badge', els => els.map(e => e.textContent)),
    };
  });

  await step('03-import-image', async () => {
    await dropTestImage(page, 'e2e-image.png', 640, 480);
    await page.waitForFunction(panel => !!document.querySelector(`${panel} .layer-item--active`), LEFT_PANEL, {
      timeout: 20000,
    });
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLCanvasElement>('.canvas-area canvas')).some(c => c.width === 640),
    );
    await page.waitForTimeout(300);
    await screenshot('import-image');
    return { toast: await lastToast(page), archives: await archiveTree(page), canvas: await canvasState(page) };
  });

  await step('04-select-log', async () => {
    await archiveItem(page, 'log.txt').click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.canvas-text-overlay')).some(o => o.style.display === 'block'),
    );
    await page.waitForTimeout(300);
    await screenshot('select-log');
    return { archives: await archiveTree(page), canvas: await canvasState(page) };
  });

  await step('05-reselect-image', async () => {
    await archiveItem(page, 'e2e-image.png').click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.canvas-text-overlay')).every(
        o => o.style.display !== 'block',
      ),
    );
    await page.waitForTimeout(500);
    return { archives: await archiveTree(page), canvas: await canvasState(page) };
  });

  await step('06-zoom', async () => {
    await page.locator('.canvas-zoom-bar button[title="Zoom In"]').click();
    const zoomIn = await page.locator('.canvas-zoom-bar__label').textContent();
    await page.locator('.canvas-zoom-bar button[title="Fit to Screen"]').click();
    const fit = await page.locator('.canvas-zoom-bar__label').textContent();
    await page.locator('.canvas-zoom-bar button').last().click();
    const reset = await page.locator('.canvas-zoom-bar__label').textContent();
    return { zoomIn, fit, reset };
  });

  await step('07-overlay-mode', async () => {
    await setMode(page, 'Overlay');
    const state = {
      columnHeaderVisible: await page.locator(`${LEFT_PANEL} .overlay-column-header`).isVisible(),
      utBoxes: await page.locator(`${LEFT_PANEL} .layer-item__ut-boxes:visible`).count(),
      checkedU: await page.locator(`${LEFT_PANEL} .layer-item__ut-cb--checked-u`).count(),
      canvas: await canvasState(page),
    };
    await screenshot('overlay-mode');
    await setMode(page, 'Normal');
    return {
      ...state,
      modesAfter: await page.$$eval('.left-toolbar__btn', els =>
        els.map(e => e.classList.contains('left-toolbar__btn--active')),
      ),
    };
  });

  await step('08-compare-mode', async () => {
    await setMode(page, 'Compare');
    await page.waitForSelector(RIGHT_PANEL);
    await page.waitForTimeout(500);
    const state = {
      aiPanelPresent: await page.locator('aside.ai-panel').count(),
      rightArchives: await archiveTree(page, RIGHT_PANEL),
      canvas: await canvasState(page),
    };
    await screenshot('compare-mode');
    await setMode(page, 'Normal');
    await page.waitForSelector('aside.ai-panel');
    return { ...state, aiPanelRestored: await page.locator('aside.ai-panel').count() };
  });

  await step('09-tool-sidebars', async () => {
    const result: Record<string, unknown> = {};
    for (const tool of ['コマ分割', '背景除去', 'Nano Banana Pro']) {
      await clickTool(page, tool);
      await page.waitForSelector('.tool-settings-sidebar', { timeout: 5000 });
      await page.waitForTimeout(400);
      result[tool] = await sidebarState(page);
      await screenshot(`sidebar-${tool}`, '.tool-settings-sidebar');
      await closeSidebar(page);
    }
    return result;
  });

  await step('10-json-preview', async () => {
    const result: Record<string, unknown> = {};
    for (const tool of ['コマ分割', 'Nano Banana Pro']) {
      await clickTool(page, tool);
      await page.waitForSelector('.tool-settings-sidebar');
      await page.locator('.tool-settings-sidebar button', { hasText: 'JSONプレビュー' }).click();
      const dialog = page.locator('dialog[open]');
      await dialog.waitFor();
      const text = (await dialog.locator('pre').textContent()) ?? '';
      result[tool] = JSON.parse(maskTimestamps(text).replace(/"<DATETIME>"/g, '"<DATETIME>"'));
      await dialog.locator('button', { hasText: '閉じる' }).click();
      await dialog.waitFor({ state: 'detached' });
      await closeSidebar(page);
    }
    return result;
  });

  await step('11-tool-error', async () => {
    // E2E has no API key, so the run fails and the AI panel records the error in error.txt.
    await clickTool(page, 'Nano Banana Pro');
    await page.waitForSelector('.tool-settings-sidebar');
    await page.locator('.tool-settings-sidebar .tool-settings-sidebar__run').click();
    const toast = await waitForToast(page, /failed/);
    await page.waitForTimeout(800);
    await closeSidebar(page);
    return { toast, archives: await archiveTree(page) };
  });

  await step('12-merge-panels', async () => {
    await createPanelFixture(page, apiBase);
    await page.locator(`${LEFT_PANEL} .layer-panel__action-btn[title="ARCHIVESを更新"]`).click();
    await waitForToast(page, /ARCHIVES/);
    await expandFolder(page, 'e2e-panels');
    await archiveItem(page, /^sub$/).click();
    await clickTool(page, 'コマ結合');
    const toast = await waitForToast(page, /結合/);
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLCanvasElement>('.canvas-area canvas')).some(
        c => c.width === 300 && c.height === 200,
      ),
    );
    await page.waitForTimeout(500);
    await screenshot('merge-panels');
    return { toast, archives: await archiveTree(page), canvas: await canvasState(page) };
  });

  await step('13-batch-mode', async () => {
    await setMode(page, 'Batch');
    await archiveItem(page, /^sub$/).click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLCanvasElement>('.canvas-area canvas')).some(c => c.width === 1660),
    );
    await page.waitForTimeout(500);
    const canvas = await canvasState(page);
    await screenshot('batch-mode');
    await setMode(page, 'Normal');
    return { canvas };
  });

  await step('14-delete-and-undo', async () => {
    await archiveItem(page, 'e2e-panels').click();
    await page.locator(`${LEFT_PANEL} .layer-panel__action-btn[title="アーカイブ削除"]`).click();
    const deleteToast = await waitForToast(page, /削除/);
    await page.waitForTimeout(500);
    const afterDelete = await archiveTree(page);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      panel =>
        Array.from(document.querySelectorAll(`${panel} .layer-item__name`)).some(e => e.textContent === 'e2e-panels'),
      LEFT_PANEL,
    );
    return { deleteToast, afterDelete, afterUndo: await archiveTree(page) };
  });

  await step('15-dialogs', async () => {
    await page.locator('.topbar__action-btn').first().click();
    await page.waitForTimeout(500);
    const settingsVisible = await page.locator('.settings-overlay:visible').count();
    const settingsLabels = await page.locator('.settings-overlay:visible label').allTextContents();
    await page.locator('.settings-overlay:visible button', { hasText: 'Cancel' }).click();

    await archiveItem(page, /e2e-image$/).click();
    await expandFolder(page, /e2e-image$/);
    await archiveItem(page, 'e2e-image.png').click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLCanvasElement>('.canvas-area canvas')).some(c => c.width === 640),
    );
    await page.keyboard.press('Control+b');
    await page.locator('.settings-overlay:visible button[title="Black"]').click();
    await page.waitForTimeout(300);
    const canvas = await canvasState(page);
    await screenshot('bg-black', '.canvas-area');
    return { settingsVisible, settingsLabels, toast: await lastToast(page), canvas };
  });

  await step('16-file-menu', async () => {
    await page.locator('.topbar__nav-item', { hasText: 'File' }).hover();
    await page.waitForTimeout(200);
    return {
      fileItems: await page.$$eval('.topbar__nav-item-wrapper:first-child .topbar__dropdown-item-label', els =>
        els.map(e => e.textContent),
      ),
    };
  });

  await step('17-delete-items-and-undo', async () => {
    await page.mouse.move(800, 500); // close the File menu
    await expandFolder(page, 'e2e-panels');
    await (await childItem(page, 'e2e-panels', 'log.txt')).click();
    await (await childItem(page, 'e2e-panels', 'sub')).click({ modifiers: ['Control'] });
    await page.locator(`${LEFT_PANEL} .layer-panel__action-btn[title="アーカイブ削除"]`).click();
    const deleteToast = await waitForToast(page, /ファイルを削除/);
    await page.waitForTimeout(500);
    const contents = async () =>
      page
        .evaluate(async apiBase => {
          const res = await fetch(`${apiBase}/archives/e2e-panels/contents`);
          return res.ok ? ((await res.json()) as { key: string }[]).map(e => e.key).sort() : [`HTTP ${res.status}`];
        }, apiBase)
        .then(keys => keys.map(maskTimestamps));
    const afterDelete = await contents();

    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      apiBase =>
        fetch(`${apiBase}/archives/e2e-panels/contents`)
          .then(r => r.json())
          .then(entries => (entries as { key: string }[]).some(e => e.key === 'e2e-panels/sub/01.png')),
      apiBase,
      { polling: 250, timeout: 10000 },
    );
    return { deleteToast, afterDelete, afterUndo: await contents() };
  });

  await step('18-batch-selection', async () => {
    const size = () =>
      page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('.canvas-area canvas');
        return c ? `${c.width}x${c.height}` : null;
      });
    const waitForSize = (expected: string) =>
      page.waitForFunction(
        expected => {
          const c = document.querySelector<HTMLCanvasElement>('.canvas-area canvas');
          return !!c && `${c.width}x${c.height}` === expected;
        },
        expected,
        { timeout: 10000 },
      );
    await page.waitForFunction(
      panel => Array.from(document.querySelectorAll(`${panel} .layer-item__name`)).some(e => e.textContent === 'sub'),
      LEFT_PANEL,
    );
    await setMode(page, 'Batch');
    await expandFolder(page, /^sub$/);
    const before = await size();

    // One file -> a one-tile grid (2 columns x 1 row).
    await archiveItem(page, '01.png').click();
    await waitForSize('1660x640');
    await page.waitForTimeout(300);
    const single = (await canvasState(page)).canvases[0];
    await screenshot('batch-single-file');

    // Files + a text file + a folder -> the 3 image files only, in tree order (2 rows).
    for (const name of [/コマ結合\.png$/, '02.png', 'panels.json', /^sub$/]) {
      await archiveItem(page, name).click({ modifiers: ['Control'] });
    }
    await waitForSize('1660x1260');
    await page.waitForTimeout(300);
    const multi = (await canvasState(page)).canvases[0];
    await screenshot('batch-multi-select');
    await setMode(page, 'Normal');
    return { before, single, multi };
  });

  await step('19-nano-banana-pro-model-api', async () => {
    const sidebar = '.tool-settings-sidebar';
    // Step 1 of the sidebar: [0] model, [1] API.
    const stepSelect = (i: number) => page.locator(`${sidebar} .nbp-step select`).nth(i);
    const nbpState = async () => ({
      ...(await sidebarState(page)),
      modelInfo: await page.locator(`${sidebar} .nbp-model-info`).innerText(),
      subtitle: await page.locator(`${sidebar} .nbp-step__subtitle`).innerText(),
    });
    const fieldInput = (label: string) =>
      page
        .locator(`${sidebar} .cs-field`, { has: page.locator('label', { hasText: new RegExp(`^${label}$`) }) })
        .locator('input');
    const previewJson = async () => {
      await page.locator(`${sidebar} button`, { hasText: 'JSONプレビュー' }).click();
      const dialog = page.locator('dialog[open]');
      await dialog.waitFor();
      const title = await dialog.locator('h3').textContent();
      const json = JSON.parse((await dialog.locator('pre').textContent()) ?? '');
      await dialog.locator('button', { hasText: '閉じる' }).click();
      await dialog.waitFor({ state: 'detached' });
      return { title, json };
    };
    const result: Record<string, unknown> = {};
    await clickTool(page, 'Nano Banana Pro');
    await page.waitForSelector(sidebar);

    await stepSelect(1).selectOption('generateContent');
    result.proGenerateContent = await nbpState();
    await screenshot('nbp-pro-generate-content', sidebar);
    await page.locator(`${sidebar} button`, { hasText: 'すべて OFF' }).click();
    await fieldInput('seed').fill('42');
    await fieldInput('temperature').fill('5'); // out of range -> red border, not sent
    await fieldInput('temperature').blur();
    result.invalidInputs = await page
      .locator(`${sidebar} input:invalid`)
      .evaluateAll(els =>
        els.map(el => ({ value: (el as HTMLInputElement).value, border: getComputedStyle(el).borderTopColor })),
      );
    await page.locator(`${sidebar} .nbp-section__title`, { hasText: '安全設定' }).scrollIntoViewIfNeeded();
    await screenshot('nbp-safety-settings', sidebar);
    result.proGenerateContentPreview = await previewJson();

    await stepSelect(0).selectOption('gemini-3.1-flash-image');
    result.flashGenerateContent = await nbpState();
    await stepSelect(1).selectOption('interactions');
    await page.locator(`${sidebar} .ar-grid__btn`, { hasText: '1:8' }).click();
    result.flashInteractions = await nbpState();
    await screenshot('nbp-flash-interactions', sidebar);
    result.flashInteractionsPreview = await previewJson();

    await stepSelect(0).selectOption('gemini-3.1-flash-lite-image');
    result.liteInteractions = await nbpState();
    await stepSelect(0).selectOption('gemini-2.5-flash-image');
    result.legacyInteractions = await nbpState();

    // Running through generateContent reaches its backend route (E2E has no API key -> missing-key error).
    await stepSelect(0).selectOption('gemini-3-pro-image');
    await stepSelect(1).selectOption('generateContent');
    await page.locator(`${sidebar} .tool-settings-sidebar__run`).click();
    result.generateContentRun = await waitForToast(page, /Nano Banana Pro failed/);
    await stepSelect(1).selectOption('interactions');
    await closeSidebar(page);
    return result;
  });
}

// ── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  fs.rmSync(opts.out, { recursive: true, force: true });
  fs.mkdirSync(opts.out, { recursive: true });

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confeito-e2e-'));
  const settingsDir = path.join(dataDir, 'settings');
  fs.mkdirSync(settingsDir, { recursive: true });
  const promptsFile = path.join(opts.root, 'settings', 'default_prompts.json');
  if (fs.existsSync(promptsFile)) fs.copyFileSync(promptsFile, path.join(settingsDir, 'default_prompts.json'));

  const apiBase = `http://127.0.0.1:${opts.backendPort}/api`;
  let backend: ChildProcess | undefined;
  let vite: ChildProcess | undefined;
  let browser: Browser | undefined;
  const obs: Record<string, unknown> = {};
  const consoleMessages: string[] = [];

  try {
    backend = startProcess(
      opts.python,
      ['-m', 'uvicorn', 'src.app.main:app', '--host', '127.0.0.1', '--port', String(opts.backendPort)],
      path.join(opts.root, 'backend'),
      {
        CONFEITO_ARCHIVES_DIR: path.join(dataDir, 'archives'),
        CONFEITO_SETTINGS_DIR: settingsDir,
        CONFEITO_ENV_FILE: path.join(dataDir, '.env'),
        GEMINI_API_KEY: '',
        PYTHONUTF8: '1',
      },
      path.join(opts.out, 'backend.log'),
    );
    vite = startProcess(
      process.execPath,
      [
        path.join(opts.root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'),
        '--port',
        String(opts.frontendPort),
        '--strictPort',
      ],
      path.join(opts.root, 'frontend'),
      { VITE_API_BASE: apiBase },
      path.join(opts.out, 'vite.log'),
    );
    await waitForHttp(`${apiBase}/health`, 180000, backend, 'backend');
    await waitForHttp(`http://localhost:${opts.frontendPort}/`, 60000, vite, 'vite');

    browser = await launchBrowser(opts.headed);
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', msg => {
      // willReadFrequently warnings come from this script's pixel sampling, not from the app.
      if (msg.text().includes('willReadFrequently')) return;
      // First line only: stack traces contain source line numbers.
      if (msg.type() === 'error' || msg.type() === 'warning')
        consoleMessages.push(`${msg.type()}: ${maskTimestamps(msg.text().split('\n')[0])}`);
    });
    page.on('pageerror', err => consoleMessages.push(`pageerror: ${err.message}`));
    await page.clock.setFixedTime(new Date('2026-01-01T10:00:00'));
    await page.addInitScript(() => {
      window.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent =
          '*,*::before,*::after{transition:none!important;animation:none!important}.toast{visibility:hidden!important}';
        document.head.appendChild(style);
      });
    });
    await page.goto(`http://localhost:${opts.frontendPort}/`);
    await runScenarios(page, apiBase, opts.out, obs);
  } finally {
    obs.console = consoleMessages;
    fs.writeFileSync(path.join(opts.out, 'observations.json'), JSON.stringify(obs, null, 2));
    await browser?.close().catch(() => {});
    killTree(vite);
    killTree(backend);
    if (!opts.keep) fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const failed = Object.entries(obs).filter(([, v]) => v && typeof v === 'object' && 'error' in (v as object));
  console.log(`[e2e] observations: ${path.join(opts.out, 'observations.json')}`);
  if (failed.length) {
    console.error(`[e2e] ${failed.length} scenario(s) failed: ${failed.map(([k]) => k).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('[e2e] all scenarios passed');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
