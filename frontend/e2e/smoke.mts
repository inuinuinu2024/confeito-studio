/**
 * E2E smoke test for ConfeitO Studio.
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

async function toolWindowState(page: Page) {
  return page.evaluate(() => {
    const win = document.querySelector<HTMLElement>('.tool-window');
    if (!win || !document.body.contains(win)) return null;
    const shown = (el: Element) => el.getClientRects().length > 0;
    return {
      title: win.querySelector('.tool-window__title')?.textContent ?? null,
      card: win.querySelector<HTMLElement>('.cs-card')?.innerText ?? null,
      labels: Array.from(win.querySelectorAll('label'))
        .filter(shown)
        .map(l => l.textContent?.trim()),
      buttons: Array.from(win.querySelectorAll('button'))
        .filter(shown)
        .map(b => b.textContent?.trim()),
      selects: Array.from(win.querySelectorAll('select')).map(s => ({
        value: s.value,
        options: Array.from(s.options).map(o => o.textContent),
      })),
      ranges: Array.from(win.querySelectorAll<HTMLInputElement>('input[type=range]')).map(r => r.value),
      textareas: Array.from(win.querySelectorAll('textarea')).map(t => t.value.slice(0, 40)),
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

/** Kind (toast--<type>) and text parts of every toast currently on screen. */
async function toastStack(page: Page) {
  const toasts = await page.$$eval('.toast', els =>
    els.map(t => ({
      type: Array.from(t.classList).find(c => c.startsWith('toast--') && c !== 'toast--visible') ?? null,
      title: t.querySelector('.toast__title')?.textContent ?? null,
      message: t.querySelector('.toast__message')?.textContent ?? null,
      detail: t.querySelector('.toast__detail')?.textContent ?? null,
      buttons: Array.from(t.querySelectorAll('button')).map(b => b.textContent),
    })),
  );
  return toasts.map(t => ({ ...t, message: t.message && maskTimestamps(t.message) }));
}

/** Runs `fn` with toasts visible (they are hidden during the run so screenshots stay stable). */
async function withVisibleToasts<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  const style = await page.addStyleTag({ content: '.toast{visibility:visible!important}' });
  try {
    return await fn();
  } finally {
    await style.evaluate(el => (el as Element).remove());
  }
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
    .locator('.ai-panel__list .ai-tool-btn')
    .filter({ has: page.locator('.ai-tool-name', { hasText: toolName }) })
    .first()
    .click();
}

async function closeToolWindow(page: Page): Promise<void> {
  const win = page.locator('.tool-window');
  if (await win.count()) {
    await win.locator('.tool-window__close').click();
    await win.waitFor({ state: 'detached', timeout: 3000 });
  }
}

async function setMode(page: Page, mode: 'Normal' | 'Compare' | 'Overlay' | 'Batch'): Promise<void> {
  await page.locator(`.left-toolbar__btn[title="${mode} Mode"]`).click();
  await page.waitForTimeout(300);
}

// ── Scenarios ─────────────────────────────────────────────────────────

async function runScenarios(
  page: Page,
  apiBase: string,
  settingsDir: string,
  out: string,
  obs: Record<string, unknown>,
): Promise<void> {
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
      toolPanelTitle: await page.locator('.ai-panel__title').textContent(),
      tools: await page.$$eval('.ai-panel__list .ai-tool-name', els => els.map(e => e.textContent)),
      status: await page.$$eval('.statusbar__status-item, .statusbar__left', els => els.map(e => e.textContent)),
      archives: await archiveTree(page),
      canvas: await canvasState(page),
    };
  });

  await step('02-tool-order', async () => {
    const names = () => page.$$eval('.ai-panel__list .ai-tool-name', els => els.map(e => e.textContent));
    const rows = page.locator('.ai-panel__list .ai-tool-row');
    const before = await names();
    // Drop the last tool on the upper half of the first one → it moves to the top.
    await rows.last().dragTo(rows.first(), { targetPosition: { x: 20, y: 4 } });
    const after = await names();
    // The order goes to the user's settings file right away (not the browser, not at the next run).
    await page.waitForTimeout(300);
    const saved = await page.evaluate(
      async apiBase =>
        ((await (await fetch(`${apiBase}/settings/tools`)).json()) as { values: Record<string, string> }).values
          .aiPanel_toolOrder,
      apiBase,
    );
    return { before, after, saved };
  });

  await step('02b-tool-not-ready', async () => {
    // Nothing is selected yet: tools report the missing input as a warning, not as a failure.
    await clickTool(page, 'コマ結合');
    await page.waitForSelector('.tool-window');
    const mergeCard = await page.locator('.tool-window .cs-card').innerText();
    await page.locator('.tool-window .tool-window__run').click();
    await waitForToast(page, /コマ結合: ARCHIVES/);
    await closeToolWindow(page);
    await clickTool(page, '背景除去');
    await page.waitForSelector('.tool-window');
    const removeBgCard = await page.locator('.tool-window .cs-card').innerText();
    await page.locator('.tool-window .tool-window__run').click();
    await waitForToast(page, /背景除去: ARCHIVES/);
    const windowStaysOpen = await page.locator('.tool-window').count();
    await closeToolWindow(page);
    return {
      mergeCard,
      removeBgCard,
      toasts: await toastStack(page),
      windowStaysOpen,
      archives: await archiveTree(page),
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

  await step('04-select-text', async () => {
    // Imports no longer write log.txt: add a text file to the imported archive and show it.
    const archive = await archiveItem(page, /e2e-image$/)
      .locator('.layer-item__name')
      .textContent();
    await page.evaluate(
      async ({ apiBase, archive }) => {
        const form = new FormData();
        form.append('name', archive ?? '');
        form.append('files', new Blob(['e2e notes\n'], { type: 'text/plain' }), 'notes.txt');
        form.append('paths', 'notes.txt');
        const res = await fetch(`${apiBase}/archives`, { method: 'POST', body: form });
        if (!res.ok) throw new Error(`text fixture upload failed: ${res.status}`);
      },
      { apiBase, archive },
    );
    await page.locator(`${LEFT_PANEL} .layer-panel__action-btn[title="ARCHIVESを更新"]`).click();
    await waitForToast(page, /ARCHIVES/);
    await archiveItem(page, 'notes.txt').click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.canvas-text-overlay')).some(o => o.style.display === 'block'),
    );
    await page.waitForTimeout(300);
    await screenshot('select-text');
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

  await step('05b-deselect-clears-save-folder', async () => {
    // Deselecting also clears the save folder: コマ結合 asks for a folder instead of using the
    // previously selected archive.
    await archiveItem(page, 'e2e-image.png').click(); // second click deselects
    await page.waitForFunction(() => !document.querySelector('.layer-item--selected'));
    await clickTool(page, 'コマ結合');
    await page.waitForSelector('.tool-window');
    await page.locator('.tool-window .tool-window__run').click();
    const toast = await waitForToast(page, /コマ結合: ARCHIVES/);
    await closeToolWindow(page);
    await archiveItem(page, 'e2e-image.png').click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLCanvasElement>('.canvas-area canvas')).some(c => c.width === 640),
    );
    return { toast, archives: await archiveTree(page) };
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

  await step('09-tool-windows', async () => {
    const result: Record<string, unknown> = {};
    for (const tool of ['コマ分割', '背景除去', 'Nano Banana画像生成']) {
      await clickTool(page, tool);
      await page.waitForSelector('.tool-window', { timeout: 5000 });
      await page.waitForTimeout(400);
      result[tool] = await toolWindowState(page);
      await screenshot(`window-${tool}`, '.tool-window');
      await closeToolWindow(page);
    }
    return result;
  });

  await step('09b-tool-window', async () => {
    // The tool window is a modal in the middle of the screen (docs/specs/ai-panel.md 「ツールの実行」).
    const win = page.locator('.tool-window');
    const isOpen = () => win.count();
    const open = async () => {
      await clickTool(page, 'コマ分割');
      await win.waitFor();
      await page.waitForTimeout(200);
    };

    await open();
    await screenshot('tool-window');
    const layout = await page.evaluate(() => {
      const r = document.querySelector('.tool-window')!.getBoundingClientRect();
      const row = document.querySelector('.layer-item')!.getBoundingClientRect();
      const hit = document.elementFromPoint(row.x + row.width / 2, row.y + row.height / 2);
      return {
        width: Math.round(r.width),
        centerOffset: [
          Math.round(r.x + r.width / 2 - innerWidth / 2),
          Math.round(r.y + r.height / 2 - innerHeight / 2),
        ],
        archivesCoveredByBackdrop: hit?.classList.contains('tool-window-overlay') ?? false,
        appInert: document.getElementById('app')!.inert,
        focusInWindow: !!document.activeElement?.closest('.tool-window'),
      };
    });

    // A drag that starts inside the window and ends on the backdrop (e.g. a slider) does not close it.
    const box = (await win.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 70);
    await page.mouse.down();
    await page.mouse.move(20, 20, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const openAfterDragOut = await isOpen();

    await page.mouse.click(20, 20); // the backdrop
    await win.waitFor({ state: 'detached' });
    const openAfterBackdropClick = await isOpen();

    await open();
    await page.keyboard.press('Escape');
    await win.waitFor({ state: 'detached' });
    const openAfterEscape = await isOpen();

    await open();
    await closeToolWindow(page);
    return {
      layout,
      openAfterDragOut,
      openAfterBackdropClick,
      openAfterEscape,
      afterClose: await page.evaluate(() => ({
        appInert: document.getElementById('app')!.inert,
        focus: document.activeElement?.textContent ?? null,
      })),
    };
  });

  await step('10-json-preview', async () => {
    const result: Record<string, unknown> = {};
    for (const tool of ['コマ分割', 'Nano Banana画像生成']) {
      await clickTool(page, tool);
      await page.waitForSelector('.tool-window');
      await page.locator('.tool-window button', { hasText: 'JSONプレビュー' }).click();
      const dialog = page.locator('dialog[open]');
      await dialog.waitFor();
      const text = (await dialog.locator('pre').textContent()) ?? '';
      result[tool] = JSON.parse(maskTimestamps(text).replace(/"<DATETIME>"/g, '"<DATETIME>"'));
      await dialog.locator('button', { hasText: '閉じる' }).click();
      await dialog.waitFor({ state: 'detached' });
      await closeToolWindow(page);
    }
    return result;
  });

  await step('10b-prompts', async () => {
    // Registered prompts per tool (docs/specs/tools/gemini-image.md 「プロンプト」): register, overwrite,
    // use, edit and delete, saved to settings/prompts.json apart from the tool settings.
    const win = '.tool-window';
    const textarea = page.locator(`${win} .nbp-prompt textarea`);
    const topModal = () => page.locator('.cs-modal-overlay--open').last();
    const promptsFile = path.join(settingsDir, 'prompts.json');
    const savedPrompts = () => {
      try {
        const data = JSON.parse(fs.readFileSync(promptsFile, 'utf-8')) as Record<
          string,
          { name: string; text: string }[]
        >;
        return Object.fromEntries(
          Object.entries(data).map(([tool, list]) => [tool, list.map(({ name, text }) => ({ name, text }))]),
        );
      } catch {
        return null;
      }
    };
    const register = async (name: string) => {
      await page.locator(`${win} button[title="このプロンプトを登録"]`).click();
      await topModal().locator('input').fill(name);
      await topModal().locator('button', { hasText: '登録' }).click();
    };
    const openLibrary = async () => {
      await page.locator(`${win} button[title="登録したプロンプトを開く"]`).click();
      await page.waitForFunction(() => {
        const list = document.querySelector('.prompt-library');
        return !!list && !list.textContent?.includes('読み込み中');
      });
    };
    const libraryItems = () => topModal().locator('.prompt-library__name').allTextContents();

    await clickTool(page, 'Nano Banana画像生成');
    await page.waitForSelector(win);
    // The field starts empty (no prompts are shipped); running without a prompt only warns.
    const initialText = await textarea.inputValue();
    await page.locator(`${win} .tool-window__run`).click();
    const emptyToast = await waitForToast(page, /プロンプトを入力してください/);
    const openAfterEmptyRun = (await page.locator(win).count()) === 1;

    await textarea.fill('線画を維持して着彩して');
    await register('着彩');
    const registerToast = await waitForToast(page, /プロンプト「着彩」を登録しました/);
    await textarea.fill('線画を維持して、淡い色で着彩して');
    await page.locator(`${win} button[title="このプロンプトを登録"]`).click();
    await topModal().locator('input').fill('着彩');
    await withVisibleToasts(page, () => screenshot('prompt-register', '.prompt-dialog-overlay .cs-modal'));
    await topModal().locator('button', { hasText: '登録' }).click();
    const overwriteMessage = await topModal().locator('.cs-modal__message').textContent();
    await screenshot('prompt-overwrite-confirm', '.cs-modal-overlay--open >> nth=-1');
    await topModal().locator('button', { hasText: '上書き' }).click();
    await waitForToast(page, /プロンプト「着彩」を上書きしました/);
    await textarea.fill('表情差分を作って');
    await register('表情差分');
    await waitForToast(page, /プロンプト「表情差分」を登録しました/);
    const afterRegister = savedPrompts();

    // 使う replaces the field; the list closes.
    await textarea.fill('');
    await openLibrary();
    const listed = await libraryItems();
    await screenshot('prompt-library', '.prompt-dialog-overlay .cs-modal');
    await topModal().locator('.prompt-library__item').first().locator('button', { hasText: '使う' }).click();
    const usedText = await textarea.inputValue();

    // Edit (renaming to a registered name only warns), then delete.
    await openLibrary();
    await topModal().locator('.prompt-library__item').nth(1).locator('button', { hasText: '編集' }).click();
    await topModal().locator('input').fill('着彩');
    await topModal().locator('button', { hasText: '保存' }).click();
    const duplicateToast = await waitForToast(page, /同じ名前のプロンプト「着彩」が登録されています/);
    await topModal().locator('input').fill('表情差分 4x4');
    await topModal().locator('button', { hasText: '保存' }).click();
    await waitForToast(page, /プロンプト「表情差分 4x4」を保存しました/);
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('.prompt-library__name')).some(n => n.textContent === '表情差分 4x4'),
    );
    const afterEdit = await libraryItems();
    await topModal().locator('.prompt-library__item').first().locator('button', { hasText: '削除' }).click();
    const deleteMessage = await topModal().locator('.cs-modal__message').textContent();
    await topModal().locator('button', { hasText: '削除' }).click();
    await waitForToast(page, /プロンプト「着彩」を削除しました/);
    await page.waitForFunction(() => document.querySelectorAll('.prompt-library__item').length === 1);
    const afterDelete = await libraryItems();
    // Esc closes only the list, not the tool window.
    await page.keyboard.press('Escape');
    await page.locator('.prompt-dialog-overlay').waitFor({ state: 'detached' });
    const openAfterEscape = (await page.locator(win).count()) === 1;

    // Running saves the field's text with the other settings (E2E has no API key, so the run fails).
    await page.locator(`${win} .tool-window__run`).click();
    await waitForToast(page, /Nano Banana画像生成の実行に失敗しました/);
    const userSettings = JSON.parse(fs.readFileSync(path.join(settingsDir, 'user_settings.json'), 'utf-8'));
    await closeToolWindow(page);
    while ((await page.locator('.toast--error').count()) > 0) {
      await withVisibleToasts(page, () => page.locator('.toast--error .toast__close').first().click());
      await page.waitForTimeout(300);
    }
    return {
      initialText,
      emptyToast,
      openAfterEmptyRun,
      registerToast,
      overwriteMessage,
      afterRegister,
      listed,
      usedText,
      duplicateToast,
      afterEdit,
      deleteMessage,
      afterDelete,
      openAfterEscape,
      savedPrompt: userSettings.nanoBananaPro_prompt ?? null,
      prompts: savedPrompts(),
    };
  });

  await step('11-tool-error', async () => {
    // E2E has no API key, so the run fails: an error toast that stays until closed, and nothing
    // is written to the archives (no error.txt, no "_error" archive).
    await clickTool(page, 'Nano Banana画像生成');
    await page.waitForSelector('.tool-window');
    await page.locator('.tool-window .tool-window__run').click();
    await waitForToast(page, /Nano Banana画像生成の実行に失敗しました/);
    await page.waitForTimeout(4500); // longer than the 4s auto-hide of other toasts
    const toasts = await toastStack(page);
    await closeToolWindow(page);
    const errorToast = page.locator('.toast--error').last();
    await withVisibleToasts(page, async () => {
      await screenshot('error-toast', '.toast-stack');
      await errorToast.locator('.toast__close').click();
    });
    await errorToast.waitFor({ state: 'detached' });
    return {
      toasts,
      errorToastsAfterClose: await page.locator('.toast--error').count(),
      archives: await archiveTree(page),
    };
  });

  await step('12-merge-panels', async () => {
    await createPanelFixture(page, apiBase);
    await page.locator(`${LEFT_PANEL} .layer-panel__action-btn[title="ARCHIVESを更新"]`).click();
    await waitForToast(page, /ARCHIVES/);
    await expandFolder(page, 'e2e-panels');
    await archiveItem(page, /^sub$/).click();
    // The tool window shows the target folder, its panels.json and the save destination.
    await clickTool(page, 'コマ結合');
    const card = page.locator('.tool-window .cs-card');
    await card.filter({ hasText: 'コマ数' }).waitFor();
    const mergeCard = await card.innerText();
    await screenshot('window-コマ結合', '.tool-window');
    await page.locator('.tool-window .tool-window__run').click();
    const toast = await waitForToast(page, /結合/);
    await page.locator('.tool-window').waitFor({ state: 'detached' }); // closes on success
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLCanvasElement>('.canvas-area canvas')).some(
        c => c.width === 300 && c.height === 200,
      ),
    );
    await page.waitForTimeout(500);
    await screenshot('merge-panels');
    // One success toast per run, carrying the result (the tool no longer shows its own toast).
    const mergeToasts = (await toastStack(page)).filter(t => t.message?.includes('結合'));
    // The result goes to "e2e-panels/<stamp>_コマ結合/" with info.json.
    const info = await page.evaluate(async apiBase => {
      const entries = (await (await fetch(`${apiBase}/archives/e2e-panels/contents`)).json()) as { key: string }[];
      const key = entries.map(e => e.key).find(k => /_コマ結合\/info\.json$/.test(k));
      if (!key) return null;
      const path = key.slice('e2e-panels/'.length);
      return (await fetch(`${apiBase}/archives/e2e-panels/extract?path=${encodeURIComponent(path)}`)).json();
    }, apiBase);
    return {
      mergeCard,
      toast,
      mergeToasts,
      info: info && JSON.parse(maskTimestamps(JSON.stringify(info))),
      archives: await archiveTree(page),
      canvas: await canvasState(page),
    };
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

  await step('16-menus', async () => {
    // File has no items: clicking it answers with the "開発中" toast (like Help).
    const menus = await page.$$eval('.topbar__nav-item-wrapper', wrappers =>
      wrappers.map(w => ({
        menu: w.querySelector('.topbar__nav-item')?.textContent ?? null,
        items: Array.from(w.querySelectorAll('.topbar__dropdown-item-label')).map(e => e.textContent),
      })),
    );
    await page.locator('.topbar__nav-item', { hasText: 'File' }).click();
    return { menus, fileToast: await waitForToast(page, /File メニュー/) };
  });

  await step('17-delete-items-and-undo', async () => {
    await page.mouse.move(800, 500);
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
    const sidebar = '.tool-window';
    // Step 1 of the window: [0] model, [1] API.
    const stepSelect = (i: number) => page.locator(`${sidebar} .nbp-step select`).nth(i);
    const nbpState = async () => ({
      ...(await toolWindowState(page)),
      modelInfo: await page.locator(`${sidebar} .nbp-model-info`).innerText(),
      // Three columns: model / API + prompt | reference images | parameters.
      columns: await page.$$eval(`${sidebar} .tool-window__column`, els =>
        els.map(e => ({
          width: Math.round(e.getBoundingClientRect().width),
          first: (e.firstElementChild as HTMLElement | null)?.innerText.split('\n')[0] ?? null,
          scrolls: e.scrollHeight > e.clientHeight,
        })),
      ),
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
    await clickTool(page, 'Nano Banana画像生成');
    await page.waitForSelector(sidebar);

    await stepSelect(1).selectOption('generateContent');
    result.proGenerateContent = await nbpState();
    result.windowLayout = await page.evaluate(() => {
      const r = document.querySelector('.tool-window')!.getBoundingClientRect();
      return {
        width: Math.round(r.width),
        marginTop: Math.round(r.top),
        marginBottom: Math.round(innerHeight - r.bottom),
      };
    });
    await screenshot('nbp-window');
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
    await page.locator(`${sidebar} .tool-window__run`).click();
    await waitForToast(page, /Nano Banana画像生成の実行に失敗しました/);
    result.generateContentRun = (await toastStack(page)).filter(t => t.type === 'toast--error');
    await stepSelect(1).selectOption('interactions');
    await closeToolWindow(page);
    return result;
  });

  await step('19b-reference-images', async () => {
    // One list of reference images; each card sets its type, ★, description and order.
    const win = '.tool-window';
    const cards = page.locator(`${win} .ref-card`);
    const cardState = () =>
      page.$$eval(`${win} .ref-card`, els =>
        els.map(el => ({
          name: el.querySelector('.ref-card__name')?.textContent ?? null,
          type: el.querySelector<HTMLSelectElement>('.ref-card__type')?.value ?? null,
          important: !!el.querySelector('.ref-card__star--on'),
          description: el.querySelector<HTMLTextAreaElement>('.ref-card__description')?.value ?? null,
        })),
      );
    const counts = () => page.locator(`${win} .ref-list__counts`).innerText();
    const addImages = (colors: string[]) =>
      page.evaluate(async colors => {
        const make = async (color: string, i: number) => {
          const c = document.createElement('canvas');
          c.width = 64;
          c.height = 48;
          const ctx = c.getContext('2d')!;
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 64, 48);
          const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'));
          return new File([blob], `ref${i}.png`, { type: 'image/png' });
        };
        const dt = new DataTransfer();
        for (const [i, color] of colors.entries()) dt.items.add(await make(color, i));
        const input = document.querySelector<HTMLInputElement>('.tool-window .ref-section input[type=file]')!;
        input.files = dt.files;
        input.dispatchEvent(new Event('change'));
      }, colors);
    await clickTool(page, 'Nano Banana画像生成');
    await page.waitForSelector(win);
    // Unsaved changes of the previous step are gone (settings are read again when the window opens).
    await page.locator(`${win} .nbp-step select`).nth(1).selectOption('interactions');
    await addImages(['#cc3333', '#3366cc']);
    await cards.nth(1).waitFor();
    const added = await cardState();

    await cards.nth(1).locator('.ref-card__type').selectOption('スタイル参照 (Style)');
    await cards.nth(0).locator('.ref-card__description').fill('主人公の線画。形を保つこと。');
    await cards.nth(1).locator('.ref-card__description').fill('塗りの参考');
    await cards.nth(0).locator('.ref-card__star').click();
    const edited = await cardState();

    // Drag the second card above the first: the numbering follows the new order.
    await cards
      .nth(1)
      .locator('.ref-card__handle')
      .dragTo(cards.nth(0), { targetPosition: { x: 40, y: 4 } });
    await page.waitForTimeout(300);
    const reordered = await cardState();
    await screenshot('nbp-reference-images', `${win} .tool-window__column:nth-child(2)`);

    // The text sent to Gemini carries each image's heading, flags and description.
    await page.locator(`${win} button`, { hasText: 'JSONプレビュー' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.waitFor();
    const json = (await dialog.locator('pre').textContent()) ?? '';
    await dialog.locator('button', { hasText: '閉じる' }).click();
    const text =
      (JSON.parse(json).input as { type: string; text?: string }[]).find(p => p.type === 'text')?.text ?? null;

    // A type may go over its recommended number (Pro: Style 3) — only the total (14) is a limit.
    await addImages(['#33aa33', '#aaaa33']);
    await cards.nth(3).waitFor();
    for (const i of [2, 3]) await cards.nth(i).locator('.ref-card__type').selectOption('スタイル参照 (Style)');
    await cards.nth(1).locator('.ref-card__type').selectOption('スタイル参照 (Style)'); // 4 Style images
    const overRecommended = {
      types: (await cardState()).map(c => c.type),
      counts: await counts(),
      overCount: await page.locator(`${win} .ref-list__count--over`).allInnerTexts(),
    };
    await screenshot('nbp-reference-over-recommended', `${win} .tool-window__column:nth-child(2)`);

    // The legacy model (Object only, 3 in total): other types become Object, the 4th image is removed,
    // and nothing more can be added.
    const modelSelect = page.locator(`${win} .nbp-step select`).first();
    await modelSelect.selectOption('gemini-2.5-flash-image');
    const legacy = { types: (await cardState()).map(c => c.type), counts: await counts() };
    await addImages(['#999999']);
    const legacyFull = {
      cards: await cards.count(),
      toast: await waitForToast(page, /合計 3 枚/),
      addArea: await page.locator(`${win} .ref-list__add`).innerText(),
    };
    await modelSelect.selectOption('gemini-3-pro-image');
    await closeToolWindow(page);
    return { added, edited, reordered, sentText: text, overRecommended, legacy, legacyFull };
  });

  await step('19c-original-image', async () => {
    // 原画: the aspect ratio follows the original, the original is padded to it, and the result is
    // cut back to the original's size. Gemini is stubbed in the browser (the stub returns the 原画 as sent).
    const win = '.tool-window';
    const middle = `${win} .tool-window__column:nth-child(2)`;
    const aspectState = () =>
      page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tool-window .ar-grid__btn'));
        return {
          disabled: buttons.length > 0 && buttons.every(b => b.disabled),
          selected: buttons.find(b => b.classList.contains('ar-grid__btn--selected'))?.textContent ?? null,
          caption: document.querySelector('.tool-window .nbp-aspect .nbp-caption')?.textContent ?? null,
        };
      });
    const originalState = () =>
      page.evaluate(() => {
        const section = document.querySelector<HTMLElement>('.tool-window .nbp-original');
        return {
          text: section?.innerText ?? null,
          hasCard: !!section?.querySelector('.nbp-original__card'),
          counts: document.querySelector<HTMLElement>('.tool-window .ref-list__counts')?.innerText ?? null,
        };
      });
    // 300 x 420, four coloured quadrants; drawn the same way again to compare with the result.
    const drawOriginal = `(() => {
      const c = document.createElement('canvas');
      c.width = 300;
      c.height = 420;
      const ctx = c.getContext('2d');
      [['#cc3333', 0, 0], ['#33aa33', 150, 0], ['#3366cc', 0, 210], ['#ddbb22', 150, 210]].forEach(([color, x, y]) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 150, 210);
      });
      return c;
    })()`;

    await clickTool(page, 'Nano Banana画像生成');
    await page.waitForSelector(win);
    await page.locator(`${win} .nbp-step select`).nth(1).selectOption('interactions');
    const before = { aspect: await aspectState(), original: await originalState() };

    await page.evaluate(async draw => {
      const c = eval(draw) as HTMLCanvasElement;
      const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'rough.png', { type: 'image/png' }));
      const input = document.querySelector<HTMLInputElement>('.tool-window .nbp-original input[type=file]')!;
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    }, drawOriginal);
    await page.waitForSelector(`${win} .nbp-original__card`);
    const withOriginal = { aspect: await aspectState(), original: await originalState() };
    await screenshot('nbp-original', middle);
    await screenshot('nbp-original-aspect', `${win} .nbp-parameters`);

    // The request: the automatic aspect ratio, and the 原画 after the reference images with its heading.
    await page.locator(`${win} button`, { hasText: 'JSONプレビュー' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.waitFor();
    const preview = JSON.parse((await dialog.locator('pre').textContent()) ?? '') as {
      input: { type: string; text?: string }[];
      response_format: Record<string, string>;
    };
    await dialog.locator('button', { hasText: '閉じる' }).click();
    const request = {
      responseFormat: preview.response_format,
      parts: preview.input.map(p => p.type),
      text: preview.input.find(p => p.type === 'text')?.text ?? null,
    };

    // A reference image larger than the upload limit (2048 px) is sent scaled down; Inputs/ keeps it as added.
    await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 3000;
      c.height = 1000;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#884488';
      ctx.fillRect(0, 0, 3000, 1000);
      const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'large.png', { type: 'image/png' }));
      const input = document.querySelector<HTMLInputElement>('.tool-window .ref-section input[type=file]')!;
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    });
    await page.locator(`${win} .ref-card`).nth(3).waitFor();

    // Run with the stub: the saved image must be the 原画's size and match it inside.
    let sentImages: { width: number; height: number }[] = [];
    await page.route('**/api/nano-banana-pro', async route => {
      const payload = route.request().postDataJSON() as { input: { type: string; data?: string }[] };
      const images = payload.input.filter(p => p.type === 'image').map(p => Buffer.from(p.data!, 'base64'));
      sentImages = images.map(b => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) })); // PNG IHDR
      const body = images.at(-1)!;
      await route.fulfill({ status: 200, contentType: 'image/png', headers: { 'Cache-Control': 'no-store' }, body });
    });
    await page.locator(`${win} .tool-window__run`).click();
    const toast = await waitForToast(page, /Nano Banana画像生成: .*画像を保存しました/);
    await page.unroute('**/api/nano-banana-pro');
    // The folder name from the toast as shown (lastToast masks the timestamps).
    const folder = await page.$$eval(
      '.toast',
      els => els.map(t => /「(.+)」に画像を保存しました/.exec(t.textContent ?? '')?.[1]).find(Boolean) ?? '',
    );
    const result = await page.evaluate(
      async ({ apiBase, folder, draw }) => {
        const archive = folder.split('/')[0];
        const entries = (await (await fetch(`${apiBase}/archives/${encodeURIComponent(archive)}/contents`)).json()) as {
          key: string;
        }[];
        const files = entries.map(e => e.key).filter(k => k.startsWith(`${folder}/`));
        const extract = (key: string) =>
          fetch(
            `${apiBase}/archives/${encodeURIComponent(archive)}/extract?path=${encodeURIComponent(key.slice(archive.length + 1))}`,
          );
        const mainKey = files.find(k => /_Nano Banana画像生成\.png$/.test(k));
        if (!mainKey) return { files };
        const info = await (await extract(`${folder}/info.json`)).json();
        const saved = await createImageBitmap(await (await extract(mainKey)).blob());
        const a = document.createElement('canvas');
        a.width = saved.width;
        a.height = saved.height;
        a.getContext('2d')!.drawImage(saved, 0, 0);
        const b = eval(draw) as HTMLCanvasElement;
        // Centres of the quadrants and points near the edges (inside the original, outside the padding).
        const points = [
          [75, 105],
          [225, 105],
          [75, 315],
          [225, 315],
          [5, 5],
          [294, 414],
          [150 - 8, 4],
          [150 + 8, 415],
        ];
        let maxDiff = 0;
        for (const [x, y] of points) {
          const p = a.getContext('2d')!.getImageData(x, y, 1, 1).data;
          const q = b.getContext('2d')!.getImageData(x, y, 1, 1).data;
          for (let i = 0; i < 3; i++) maxDiff = Math.max(maxDiff, Math.abs(p[i] - q[i]));
        }
        const large = await createImageBitmap(await (await extract(`${folder}/Inputs/Image4.png`)).blob());
        return {
          files: files.map(k => k.slice(folder.length + 1)).sort(),
          savedLargeReference: [large.width, large.height],
          info,
          savedSize: [saved.width, saved.height],
          maxDiff,
        };
      },
      { apiBase, folder, draw: drawOriginal },
    );

    // The image on the canvas (the result, selected after saving) can be the 原画 too; × removes it.
    await clickTool(page, 'Nano Banana画像生成');
    await page.waitForSelector(win);
    await page.locator(`${win} .nbp-original__card .ref-card__remove`).click();
    await page.locator(`${win} button`, { hasText: '表示中の画像を原画にする' }).click();
    await page.waitForSelector(`${win} .nbp-original__card`);
    const fromCanvas = { aspect: await aspectState(), original: await originalState() };
    await page.locator(`${win} .nbp-original__card .ref-card__remove`).click();
    await page.waitForSelector(`${win} .nbp-original__add`);
    const removed = { aspect: await aspectState(), original: await originalState() };
    await closeToolWindow(page);
    return {
      before,
      withOriginal,
      request,
      sentImages,
      toast,
      result: JSON.parse(maskTimestamps(JSON.stringify(result))),
      fromCanvas: JSON.parse(maskTimestamps(JSON.stringify(fromCanvas))),
      removed,
    };
  });

  await step('19d-generation-blocked', async () => {
    // Gemini answered without an image (here: PROHIBITED_CONTENT). The backend's 422 body
    // (providers/gemini_reasons.py, unit tested in backend/tests/test_gemini_reasons.py) is stubbed in the browser.
    const finishMessage =
      "Unable to show the generated image. The image was filtered out because it violated Google's " +
      'Generative AI Prohibited Use policy. Try rephrasing the prompt.';
    const geminiResponse = {
      candidates: [{ content: {}, finishReason: 'PROHIBITED_CONTENT', index: 0, finishMessage }],
      usageMetadata: { promptTokenCount: 341, totalTokenCount: 498, thoughtsTokenCount: 157 },
    };
    const detail = {
      message:
        '画像が生成されませんでした（finishReason: PROHIBITED_CONTENT）。' +
        'Google の利用ポリシーで禁止されている内容と判定されました。' +
        '安全設定では解除できません。プロンプトや参照画像を変えてください。',
      raw_response:
        `finishReason: PROHIBITED_CONTENT\nfinishMessage: ${finishMessage}\n\n` +
        JSON.stringify(geminiResponse, null, 2),
    };
    await page.route('**/api/nano-banana-pro', route =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify({ detail }),
      }),
    );
    await clickTool(page, 'Nano Banana画像生成');
    await page.waitForSelector('.tool-window');
    await page.locator('.tool-window .nbp-step select').nth(1).selectOption('interactions');
    await page.locator('.tool-window .tool-window__run').click();
    await waitForToast(page, /PROHIBITED_CONTENT/);
    await page.unroute('**/api/nano-banana-pro');
    const toasts = (await toastStack(page)).filter(t => t.type === 'toast--error');
    await closeToolWindow(page);
    // Error toasts stay until closed: shoot the new one, then close every error toast.
    await withVisibleToasts(page, async () => {
      await screenshot('nbp-blocked-toast', '.toast--error >> nth=-1');
      while ((await page.locator('.toast--error').count()) > 0) {
        const count = await page.locator('.toast--error').count();
        await page.locator('.toast--error .toast__close').first().click();
        await page.waitForFunction(n => document.querySelectorAll('.toast--error').length < n, count);
      }
    });
    return { toasts };
  });

  await step('19e-settings-timing', async () => {
    // Settings are read when a tool window opens and written when a run starts
    // (docs/specs/app-shell.md 「設定の保存」). The user's values go to user_settings.json.
    const win = '.tool-window';
    const userFile = path.join(settingsDir, 'user_settings.json');
    const savedSeed = () => {
      try {
        return (JSON.parse(fs.readFileSync(userFile, 'utf-8')) as Record<string, string>).nanoBananaPro_seed ?? null;
      } catch {
        return null;
      }
    };
    const seedInput = () =>
      page.locator(`${win} .cs-field`, { has: page.locator('label', { hasText: /^seed$/ }) }).locator('input');
    const openTool = async () => {
      await clickTool(page, 'Nano Banana画像生成');
      await page.waitForSelector(win);
    };

    await openTool();
    const initial = await seedInput().inputValue();
    // Changed but not run: nothing is written, and reopening shows the saved value again.
    await seedInput().fill('777');
    await closeToolWindow(page);
    const notRun = { file: savedSeed() };
    await openTool();
    const reopened = await seedInput().inputValue();

    // Run (E2E has no API key, so it fails): the settings are saved when the run starts.
    await seedInput().fill('777');
    await page.locator(`${win} .tool-window__run`).click();
    await waitForToast(page, /Nano Banana画像生成の実行に失敗しました/);
    const afterRun = { file: savedSeed() };
    await closeToolWindow(page);
    await openTool();
    const reopenedAfterRun = await seedInput().inputValue();
    await closeToolWindow(page);

    // A broken user file is moved aside (not overwritten) and reported when a tool opens.
    fs.writeFileSync(userFile, '{broken', 'utf-8');
    await openTool();
    const brokenToast = await waitForToast(page, /壊れていたため/);
    const broken = {
      toast: brokenToast.replace(/broken-\d{8}_\d{6}/, 'broken-<STAMP>'),
      seed: await seedInput().inputValue(),
      backups: fs.readdirSync(settingsDir).filter(f => f.startsWith('user_settings.broken-')).length,
      userFileExists: fs.existsSync(userFile),
    };
    await closeToolWindow(page);
    return { initial, notRun, reopened, afterRun, reopenedAfterRun, broken };
  });

  await step('20-browser-storage', async () => {
    // Nothing is kept in the browser (docs/specs/app-shell.md 「ブラウザに残すもの」).
    return page.evaluate(async () => ({
      localStorage: localStorage.length,
      sessionStorage: sessionStorage.length,
      indexedDB: (await indexedDB.databases()).map(db => db.name),
    }));
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
  const defaultsFile = path.join(opts.root, 'settings', 'default_settings.json');
  if (fs.existsSync(defaultsFile)) fs.copyFileSync(defaultsFile, path.join(settingsDir, 'default_settings.json'));

  const apiBase = `http://127.0.0.1:${opts.backendPort}/api`;
  let backend: ChildProcess | undefined;
  let vite: ChildProcess | undefined;
  let browser: Browser | undefined;
  const obs: Record<string, unknown> = {};
  const consoleMessages: string[] = [];
  /** App responses (dev server / backend) without `Cache-Control: no-store`; expected to stay empty. */
  const storableResponses = new Set<string>();

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
    page.on('response', res => {
      const url = new URL(res.url());
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) return;
      const cacheControl = res.headers()['cache-control'];
      if (cacheControl !== 'no-store')
        storableResponses.add(`${res.status()} ${url.pathname} (${cacheControl ?? 'none'})`);
    });
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
    await runScenarios(page, apiBase, settingsDir, opts.out, obs);
  } finally {
    obs.storableResponses = [...storableResponses].sort();
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
