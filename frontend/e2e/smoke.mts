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
import { chromium, type Browser, type Page, type Route } from 'playwright-core';

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

const LEFT_PANEL = 'aside.layer-panel';
const LEFT_VIEWPORT = '.canvas-split__pane--left .canvas-split__viewport';

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

/** Checkbox column 0 / 1 of an image row (Parallel L / R, Overlay U / T). */
function layerBox(page: Page, name: string, column: 0 | 1) {
  return archiveItem(page, name).locator('.layer-item__layer-cb').nth(column);
}

/** Names of the rows checked in each checkbox column, and the column labels. */
async function layerColumns(page: Page) {
  return page.evaluate(panel => {
    const checked = (column: number) =>
      Array.from(document.querySelectorAll(`${panel} .layer-item`))
        .filter(row =>
          row.querySelectorAll('.layer-item__layer-cb')[column]?.classList.contains('layer-item__layer-cb--checked'),
        )
        .map(row => row.querySelector('.layer-item__name')?.textContent ?? '');
    const header = document.querySelector<HTMLElement>(`${panel} .layer-column-header`);
    return {
      header:
        header && header.getClientRects().length
          ? Array.from(header.querySelectorAll('.layer-column-header__label')).map(l => l.textContent)
          : null,
      visibleBoxes: Array.from(document.querySelectorAll<HTMLElement>(`${panel} .layer-item__layer-boxes`)).filter(
        b => b.getClientRects().length > 0,
      ).length,
      columns: [checked(0), checked(1)],
    };
  }, LEFT_PANEL);
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

async function collapseFolder(page: Page, name: string | RegExp, panel = LEFT_PANEL): Promise<void> {
  const chevron = archiveItem(page, name, panel).locator('.layer-item__icon--chevron');
  if ((await chevron.textContent()) === 'expand_more') {
    await chevron.click();
    await page.waitForFunction(
      ({ panel, source }) =>
        Array.from(document.querySelectorAll(`${panel} .layer-item`)).some(
          el =>
            new RegExp(source).test(el.querySelector('.layer-item__name')?.textContent ?? '') &&
            el.querySelector('.layer-item__icon--chevron')?.textContent === 'chevron_right',
        ),
      { panel, source: typeof name === 'string' ? name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : name.source },
    );
  }
}

/** Waits until the canvas shows its empty message, and returns it (timestamps masked). */
async function waitForEmptyMessage(page: Page, pattern: RegExp): Promise<string> {
  await page.waitForFunction(
    source => {
      const empty = document.querySelector<HTMLElement>('.canvas-empty');
      const text = document.querySelector('.canvas-empty__message')?.textContent ?? '';
      return !!empty && empty.getClientRects().length > 0 && new RegExp(source).test(text);
    },
    pattern.source,
    { timeout: 10000 },
  );
  return maskTimestamps((await page.locator('.canvas-empty__message').textContent()) ?? '');
}

/** The card of a tool's window (what it will process), closing the window afterwards. */
async function toolCard(page: Page, toolName: string): Promise<string> {
  await clickTool(page, toolName);
  await page.waitForSelector('.tool-window .cs-card');
  await page.waitForTimeout(300);
  const card = maskTimestamps(await page.locator('.tool-window .cs-card').first().innerText());
  await closeToolWindow(page);
  return card;
}

const waitForCanvasWidth = (page: Page, width: number) =>
  page.waitForFunction(
    width =>
      !document.querySelector<HTMLElement>('.canvas-empty')?.getClientRects().length &&
      Array.from(document.querySelectorAll<HTMLCanvasElement>('.canvas-area canvas')).some(c => c.width === width),
    width,
    { timeout: 10000 },
  );

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
        toolbarGroupsVisible: Array.from(document.querySelectorAll('.canvas-toolbar__group')).map(visible),
        textOverlays: Array.from(document.querySelectorAll<HTMLElement>('.canvas-text-overlay')).map(o => ({
          visible: visible(o),
          text: (o.textContent ?? '').slice(0, 300),
        })),
        // Message shown while nothing is displayed (null when hidden).
        emptyMessage: visible(document.querySelector('.canvas-empty'))
          ? (document.querySelector('.canvas-empty__message')?.textContent ?? null)
          : null,
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

/**
 * Opens Nano Banana画像生成 and removes the 原画, which the image on the canvas fills when the window opens
 * (docs/specs/tools/nano-banana-pro.md 「原画」): for scenarios about the tool without one.
 */
async function openNanoBananaWithoutOriginal(page: Page): Promise<void> {
  await clickTool(page, 'Nano Banana画像生成');
  await page.waitForSelector('.tool-window');
  const remove = page.locator('.tool-window .nbp-original__card .ref-card__remove');
  if (await remove.count()) {
    await remove.click();
    await page.waitForSelector('.tool-window .nbp-original__add');
  }
}

/** The ▶ / ⏸ button at the right end of a tool's row. */
function playButton(page: Page, toolName: string) {
  return page
    .locator('.ai-panel__list .ai-tool-row')
    .filter({ has: page.locator('.ai-tool-name', { hasText: toolName }) })
    .first()
    .locator('.ai-tool-play');
}

/** A PNG of `width` x `height` drawn in the page. */
async function makePng(page: Page, width: number, height: number): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ([w, h]) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#5577aa';
      ctx.fillRect(0, 0, w, h);
      const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return btoa(String.fromCharCode(...bytes));
    },
    [width, height],
  );
  return Buffer.from(base64, 'base64');
}

/**
 * Answers the backend's file dialog (POST /api/local-files/pick-image) with `file`, or as cancelled
 * when null; the request bodies are pushed to `requests`. Replaces the previous stub.
 */
async function stubFileDialog(
  page: Page,
  file: { name: string; body: Buffer } | null,
  requests: { initial_dir: string }[],
): Promise<void> {
  await page.unroute('**/api/local-files/pick-image');
  await page.route('**/api/local-files/pick-image', route => {
    requests.push(route.request().postDataJSON() as { initial_dir: string });
    if (!file) return route.fulfill({ status: 204, headers: { 'Cache-Control': 'no-store' } });
    return route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: {
        'Cache-Control': 'no-store',
        'X-File-Name': encodeURIComponent(file.name),
        'Access-Control-Expose-Headers': 'X-File-Name',
      },
      body: file.body,
    });
  });
}

async function closeToolWindow(page: Page): Promise<void> {
  const win = page.locator('.tool-window');
  if (!(await win.count())) return;
  // A run closes the window itself; then it is only fading out.
  if (await page.locator('.tool-window-overlay--open').count()) await win.locator('.tool-window__close').click();
  await win.waitFor({ state: 'detached', timeout: 3000 });
}

/** Parallel mode layout: the fixed panes, their scroll positions, the boundary / divider and the per-pane notices. */
async function parallelState(page: Page) {
  return page.evaluate(() => {
    const round = (r: DOMRect) => ({
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
    const shown = (el: Element | null) =>
      !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
    const split = document.querySelector<HTMLElement>('.canvas-split')!;
    const panes = Array.from(split.querySelectorAll<HTMLElement>('.canvas-split__pane')).map(pane => {
      const viewport = pane.querySelector<HTMLElement>('.canvas-split__viewport')!;
      const canvas = pane.querySelector('canvas');
      const boundary = getComputedStyle(pane, '::after');
      return {
        visible: shown(pane),
        rect: round(pane.getBoundingClientRect()),
        // The area the 100% zoom fits the canvas into (viewport minus its 64px padding).
        available: { w: viewport.clientWidth - 64, h: viewport.clientHeight - 64 },
        canvas: canvas ? { ...round(canvas.getBoundingClientRect()), title: canvas.title } : null,
        scroll: { left: Math.round(viewport.scrollLeft), top: Math.round(viewport.scrollTop) },
        front: pane.classList.contains('canvas-split__pane--front'),
        clipPath: pane.style.clipPath || null,
        boundary: boundary.content !== 'none' ? { width: boundary.width, color: boundary.backgroundColor } : null,
        notice: shown(pane.querySelector('.canvas-split__pane-empty'))
          ? (pane.querySelector('.canvas-split__pane-message')?.textContent ?? null)
          : null,
        text: shown(pane.querySelector('.canvas-text-overlay')),
      };
    });
    const divider = split.querySelector<HTMLElement>('.canvas-split__divider')!;
    return {
      split: round(split.getBoundingClientRect()),
      panes,
      divider: shown(divider)
        ? { ...round(divider.getBoundingClientRect()), color: getComputedStyle(divider).backgroundColor }
        : null,
      zoomLabel: document.querySelector('.canvas-zoom-bar__label')?.textContent ?? null,
      zoomBarVisible: shown(document.querySelector('.canvas-zoom-bar')),
      globalEmptyVisible: shown(document.querySelector('.canvas-empty')),
    };
  });
}

const MODE_BUTTONS = {
  Normal: 'Normal Mode',
  Batch: 'Batch Mode',
  Parallel: 'Parallel View',
  Overlay: 'Overlay View',
} as const;

async function setMode(page: Page, mode: keyof typeof MODE_BUTTONS): Promise<void> {
  await page.locator(`.left-toolbar__btn[title="${MODE_BUTTONS[mode]}"]`).click();
  await page.waitForTimeout(300);
}

// ── Scenarios ─────────────────────────────────────────────────────────

async function runScenarios(
  page: Page,
  apiBase: string,
  settingsDir: string,
  out: string,
  obs: Record<string, unknown>,
  seedUsage: (records: object[]) => void,
): Promise<void> {
  let shot = 0;
  /** The registered prompts (CONFEITO_ASSETS_DIR is <dataDir>/assets). */
  const promptsFile = path.join(path.dirname(settingsDir), 'assets', 'prompts', 'prompts.json');
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
      topbarActions: await page.$$eval('.topbar__action-btn', els => els.map(e => e.getAttribute('title'))),
      // Buttons top to bottom, with dividers between Batch and Parallel, before the managers and before Cost Monitor.
      toolbarItems: await page.$$eval('.left-toolbar > *', els =>
        els.map(e => e.getAttribute('title') ?? (e.classList.contains('left-toolbar__divider') ? '---' : '?')),
      ),
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

  await step('01b-managers', async () => {
    // The managers after Character Manager are not implemented yet: each shows a "開発中" toast and changes nothing else.
    for (const title of ['Object Manager', 'Style Manager']) {
      await page.locator(`.left-toolbar__btn[title="${title}"]`).click();
    }
    const toasts = await toastStack(page);
    const activeModes = await page.$$eval('.left-toolbar__btn--active', els => els.map(e => e.getAttribute('title')));
    // Let the toasts hide so they do not leak into the next steps' observations.
    await page.waitForFunction(() => !document.querySelector('.toast--mock'), undefined, { timeout: 10000 });
    return { toasts, activeModes };
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

  await step('05c-normal-selection', async () => {
    // Normal mode shows only a single selected file; a folder or several entries clear the canvas
    // and the tools have no image (docs/specs/canvas.md 「表示ルール」).
    await archiveItem(page, /e2e-image$/).click();
    const folder = await waitForEmptyMessage(page, /フォルダ「/);
    await screenshot('normal-folder-selected', '.canvas-area');
    const folderRemoveBg = await toolCard(page, '背景除去');
    const folderMerge = await toolCard(page, 'コマ結合');

    await archiveItem(page, 'e2e-image.png').click();
    await waitForCanvasWidth(page, 640);
    await archiveItem(page, 'notes.txt').click({ modifiers: ['Control'] });
    const multiple = await waitForEmptyMessage(page, /件を選択中/);
    // Ctrl+click back to one file shows that file.
    await archiveItem(page, 'notes.txt').click({ modifiers: ['Control'] });
    await waitForCanvasWidth(page, 640);
    const backToOne = await canvasState(page);

    // A text file: shown as text, and the tools have no image.
    await archiveItem(page, 'notes.txt').click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.canvas-text-overlay')).some(o => o.style.display === 'block'),
    );
    const textRemoveBg = await toolCard(page, '背景除去');

    // Collapsing the parent folder hides (deselects) the image: the canvas empties.
    await archiveItem(page, 'e2e-image.png').click();
    await waitForCanvasWidth(page, 640);
    await collapseFolder(page, /e2e-image$/);
    const collapsed = await waitForEmptyMessage(page, /^ARCHIVES から画像を選択してください$/);
    const treeCollapsed = await archiveTree(page);
    await expandFolder(page, /e2e-image$/);
    await archiveItem(page, 'e2e-image.png').click();
    await waitForCanvasWidth(page, 640);
    await page.waitForTimeout(300);
    return {
      folder,
      folderRemoveBg,
      folderMerge,
      multiple,
      backToOne: { emptyMessage: backToOne.emptyMessage, size: backToOne.canvases.map(c => `${c.w}x${c.h}`) },
      textRemoveBg,
      collapsed,
      treeCollapsed: treeCollapsed.map(r => ({ ...r, name: maskTimestamps(r.name) })),
    };
  });

  await step('06-zoom', async () => {
    // Canvas position inside the visible scroll area (px from its top-left corner).
    const canvasBox = () =>
      page.$eval(LEFT_VIEWPORT, area => {
        const a = area.getBoundingClientRect();
        const r = area.querySelector('.canvas-split__inner')!.getBoundingClientRect();
        return {
          left: Math.round(r.left - a.left),
          top: Math.round(r.top - a.top),
          right: Math.round(a.left + area.clientWidth - r.right),
          bottom: Math.round(a.top + area.clientHeight - r.bottom),
        };
      });
    const dragCanvas = async (dx: number, dy: number) => {
      const area = (await page.locator(LEFT_VIEWPORT).boundingBox())!;
      const x = area.x + area.width / 2;
      const y = area.y + area.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 5 });
      await page.mouse.up();
    };

    await page.locator('.canvas-zoom-bar button[title="Zoom In"]').click();
    const zoomIn = await page.locator('.canvas-zoom-bar__label').textContent();
    await page.locator('.canvas-zoom-bar button[title="Fit to Screen"]').click();
    const fit = await page.locator('.canvas-zoom-bar__label').textContent();
    await page.waitForTimeout(100);
    const fitBox = await canvasBox();

    // Dragging moves the canvas even when it fits; it stops with 64px of an edge on screen.
    await dragCanvas(-150, 80);
    const draggedBox = await canvasBox();
    await dragCanvas(-3000, -3000);
    const draggedFarBox = await canvasBox();
    await screenshot('canvas-dragged', '.canvas-area');

    await page.locator('.canvas-zoom-bar button[title="Fit Width"]').click();
    const fitWidth = await page.locator('.canvas-zoom-bar__label').textContent();
    await page.waitForTimeout(100);
    const fitWidthBox = await canvasBox();
    await screenshot('zoom-fit-width', '.canvas-area');
    // Fit to Screen is 100% (there is no separate 100% button).
    await page.locator('.canvas-zoom-bar button[title="Fit to Screen"]').click();
    const reset = await page.locator('.canvas-zoom-bar__label').textContent();
    await page.waitForTimeout(100);
    return {
      zoomIn,
      fit,
      fitBox,
      draggedBox,
      draggedFarBox,
      fitWidth,
      fitWidthBox,
      reset,
      resetBox: await canvasBox(),
    };
  });

  await step('07-overlay-mode', async () => {
    await setMode(page, 'Overlay');
    const state = {
      layers: await layerColumns(page),
      aiPanelVisible: await page.locator('aside.ai-panel').isVisible(),
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

  await step('08-parallel-mode', async () => {
    // The right sidebar closes; L / R start empty (the selection is not shown) and are chosen with the checkboxes.
    await setMode(page, 'Parallel');
    await page.waitForTimeout(500);
    const state = {
      aiPanelVisible: await page.locator('aside.ai-panel').isVisible(),
      archivesPanels: await page.locator('aside.layer-panel').count(),
      layers: await layerColumns(page),
      panes: await parallelState(page),
      canvas: await canvasState(page),
    };
    await screenshot('parallel-mode-start');
    await setMode(page, 'Normal');
    await page.waitForSelector('aside.ai-panel', { state: 'visible' });
    return { ...state, aiPanelRestored: await page.locator('aside.ai-panel').isVisible() };
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
    // Registered prompts from a tool (docs/specs/tools/gemini-image.md 「プロンプト」): register (with a
    // category; a registered name is overwritten after a confirmation) and pick (category filter, search, 使う).
    // They are shared by every tool and saved to assets/prompts/prompts.json apart from the tool settings.
    const win = '.tool-window';
    const textarea = page.locator(`${win} .nbp-prompt textarea`);
    const topModal = () => page.locator('.cs-modal-overlay--open').last();
    const register = async (name: string, category: string) => {
      await page.locator(`${win} button[title="このプロンプトを登録"]`).click();
      await topModal().locator('input').first().fill(name);
      await topModal().locator('.cs-suggest input').fill(category);
      await topModal().locator('button', { hasText: '登録' }).click();
    };
    const openPicker = async () => {
      await page.locator(`${win} button[title="登録したプロンプトを開く"]`).click();
      await page.waitForFunction(() => {
        const list = document.querySelector('.prompt-library');
        return !!list && !list.textContent?.includes('読み込み中');
      });
    };
    const pickerItems = () =>
      page.$$eval('.cs-modal-overlay--open .prompt-library__item', els =>
        els.map(e => [
          e.querySelector('.prompt-library__name')?.textContent,
          e.querySelector('.prompt-library__category')?.textContent,
        ]),
      );

    await clickTool(page, 'Nano Banana画像生成');
    await page.waitForSelector(win);
    // The field starts empty (no prompts are shipped); running without a prompt only warns.
    const initialText = await textarea.inputValue();
    await page.locator(`${win} .tool-window__run`).click();
    const emptyToast = await waitForToast(page, /プロンプトを入力してください/);
    const openAfterEmptyRun = (await page.locator(win).count()) === 1;

    // An empty picker.
    await openPicker();
    const emptyPicker = await topModal().locator('.prompt-library').textContent();
    await page.keyboard.press('Escape');
    await page.locator('.prompt-dialog-overlay').waitFor({ state: 'detached' });

    await textarea.fill('線画を維持して着彩して');
    await register('着彩', '塗り');
    const registerToast = await waitForToast(page, /プロンプト「着彩」を登録しました/);
    await textarea.fill('線画を維持して、淡い色で着彩して');
    await page.locator(`${win} button[title="このプロンプトを登録"]`).click();
    await topModal().locator('input').first().fill('着彩');
    await topModal().locator('.cs-suggest input').fill('塗り');
    await page.waitForFunction(() => document.querySelectorAll('.cs-modal-overlay--open datalist option').length > 0);
    const categorySuggestions = await topModal()
      .locator('datalist option')
      .evaluateAll(els => els.map(e => (e as HTMLOptionElement).value));
    await withVisibleToasts(page, () => screenshot('prompt-register', '.prompt-dialog-overlay .cs-modal'));
    await topModal().locator('button', { hasText: '登録' }).click();
    const overwriteMessage = await topModal().locator('.cs-modal__message').textContent();
    await screenshot('prompt-overwrite-confirm', '.cs-modal-overlay--open >> nth=-1');
    await topModal().locator('button', { hasText: '上書き' }).click();
    await waitForToast(page, /プロンプト「着彩」を上書きしました/);
    await textarea.fill('表情差分を作って');
    await register('表情差分', '');
    await waitForToast(page, /プロンプト「表情差分」を登録しました/);
    await textarea.fill('夕焼けの空にして');
    await register('夕焼け', '背景');
    await waitForToast(page, /プロンプト「夕焼け」を登録しました/);
    const afterRegister = JSON.parse(fs.readFileSync(promptsFile, 'utf-8')) as {
      categories: string[];
      prompts: { name: string; category: string; text: string }[];
    };

    // Picker: すべて in category order (未分類 last), a category filter, a search; 使う replaces the field.
    await textarea.fill('');
    await openPicker();
    const listed = await pickerItems();
    const categoryOptions = await topModal().locator('.prompt-library__category-select option').allTextContents();
    await screenshot('prompt-picker', '.prompt-dialog-overlay .cs-modal');
    await topModal().locator('.prompt-library__category-select').selectOption({ label: '背景' });
    const filtered = await pickerItems();
    await topModal().locator('.prompt-library__category-select').selectOption({ label: 'すべて' });
    await topModal().locator('input[type="search"]').fill('淡い');
    const searched = await pickerItems();
    await topModal().locator('input[type="search"]').fill('存在しない');
    const noMatch = await topModal().locator('.prompt-library').textContent();
    await topModal().locator('input[type="search"]').fill('');
    const hasEditButtons = (await topModal().locator('button', { hasText: '編集' }).count()) > 0;
    await topModal().locator('.prompt-library__item').first().locator('button', { hasText: '使う' }).click();
    const useToast = await waitForToast(page, /プロンプト「着彩」を読み込みました/);
    const usedText = await textarea.inputValue();

    // Esc closes only the picker, not the tool window.
    await openPicker();
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
      emptyPicker,
      registerToast,
      categorySuggestions,
      overwriteMessage,
      afterRegister: afterRegister.prompts.map(p => [p.name, p.category, p.text]),
      categories: afterRegister.categories,
      listed,
      categoryOptions,
      filtered,
      searched,
      noMatch,
      hasEditButtons,
      useToast,
      usedText,
      openAfterEscape,
      savedPrompt: userSettings.nanoBananaPro_prompt ?? null,
      oldSettingsFile: fs.existsSync(path.join(settingsDir, 'prompts.json')),
    };
  });

  await step('10c-prompt-manager', async () => {
    // Prompt Manager (docs/specs/prompt-manager.md): a view mode with categories in the ARCHIVES column
    // and list | editor in the canvas column. Starts with 塗り: 着彩 / 背景: 夕焼け / 未分類: 表情差分 (10b).
    const topModal = () => page.locator('.cs-modal-overlay--open').last();
    const exact = (text: string) => new RegExp(`^${text}$`);
    const categoryRow = (label: string) =>
      page
        .locator('.mgr-sidebar--prompt .mgr-category')
        .filter({ has: page.locator('.mgr-category__name', { hasText: exact(label) }) });
    const promptRow = (name: string) =>
      page
        .locator('.mgr-main--prompt .mgr-item')
        .filter({ has: page.locator('.mgr-item__name', { hasText: exact(name) }) });
    const editor = {
      name: page.locator('.mgr-main--prompt .mgr-editor input').first(),
      category: page.locator('.mgr-main--prompt .mgr-editor .cs-suggest input'),
      text: page.locator('.mgr-main--prompt .mgr-editor textarea'),
    };
    const editorButton = (label: string) =>
      page.locator('.mgr-main--prompt .mgr-editor__actions button', { hasText: label });
    const view = () =>
      page.evaluate(() => {
        const shown = (sel: string) => {
          const el = document.querySelector(sel);
          return !!el && (el as HTMLElement).getClientRects().length > 0;
        };
        const row = (e: Element) => {
          if (e.classList.contains('mgr-list__group')) return `## ${e.textContent}`;
          if (!e.classList.contains('mgr-item')) return `(${e.textContent})`;
          const marks = `${e.classList.contains('mgr-item--active') ? '>' : ''}${e.classList.contains('mgr-item--sortable') ? '⋮' : ''}`;
          return `${marks}${e.querySelector('.mgr-item__name')?.textContent}`;
        };
        return {
          categories: Array.from(document.querySelectorAll('.mgr-sidebar--prompt .mgr-category')).map(e => [
            e.querySelector('.mgr-category__name')?.textContent,
            e.querySelector('.mgr-category__count')?.textContent,
            e.classList.contains('mgr-category--active'),
          ]),
          list: Array.from(
            document.querySelectorAll('.mgr-main--prompt :is(.mgr-list__group, .mgr-item, .mgr-list__empty)'),
          ).map(row),
          editor: shown('.mgr-main--prompt .mgr-editor__form')
            ? {
                title: document.querySelector('.mgr-main--prompt .mgr-editor__title')?.textContent,
                dirty: shown('.mgr-main--prompt .mgr-editor__dirty'),
                buttons: Array.from(
                  document.querySelectorAll<HTMLElement>('.mgr-main--prompt .mgr-editor__actions button'),
                )
                  .filter(b => b.getClientRects().length > 0)
                  .map(b => b.textContent),
              }
            : document.querySelector('.mgr-main--prompt .mgr-editor__empty')?.textContent,
          archivesShown: shown('.layer-panel'),
          canvasShown: shown('.canvas-area'),
          aiPanelShown: shown('.ai-panel'),
          activeModes: Array.from(document.querySelectorAll('.left-toolbar__btn--active')).map(e =>
            e.getAttribute('title'),
          ),
        };
      });
    const saved = () =>
      JSON.parse(fs.readFileSync(promptsFile, 'utf-8')) as {
        categories: string[];
        prompts: { name: string; category: string; text: string }[];
      };
    const savedOrder = () => {
      const data = saved();
      return { categories: data.categories, prompts: data.prompts.map(p => `${p.category || '-'}/${p.name}`) };
    };
    /** Waits until the file has the order (drops are saved after the rows move). */
    const waitForSavedOrder = async (check: (order: ReturnType<typeof savedOrder>) => boolean) => {
      for (let i = 0; i < 50 && !check(savedOrder()); i++) await page.waitForTimeout(100);
      return savedOrder();
    };

    await page.locator('.left-toolbar__btn[title="Prompt Manager"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.mgr-main--prompt .mgr-item').length === 3);
    const opened = await view();
    await screenshot('prompt-manager');

    // Open a prompt, edit it; switching to another prompt asks: キャンセル stays, 破棄 drops the change.
    await promptRow('着彩').click();
    await editor.text.fill('線画を維持して、濃い色で着彩して');
    const dirty = await view();
    await promptRow('夕焼け').click();
    const leaveMessage = await topModal().locator('.cs-modal__message').textContent();
    const leaveButtons = await topModal().locator('button').allTextContents();
    await screenshot('prompt-manager-unsaved', '.cs-modal-overlay--open >> nth=-1');
    await topModal().locator('button', { hasText: 'キャンセル' }).click();
    const afterCancel = await editor.text.inputValue();
    // Ctrl+S saves while typing.
    await editor.text.press('Control+s');
    const ctrlSToast = await waitForToast(page, /プロンプト「着彩」を保存しました/);
    const savedText = saved().prompts.find(p => p.name === '着彩')?.text;

    // A duplicate name only warns; leaving the change with 破棄.
    await promptRow('夕焼け').click();
    await editor.name.fill('着彩');
    await editorButton('保存').click();
    const duplicateToast = await waitForToast(page, /同じ名前のプロンプト「着彩」が登録されています/);
    await promptRow('表情差分').click();
    await topModal().locator('button', { hasText: '破棄' }).click();
    const afterDiscard = await view();

    // New prompt in the selected category; it goes to the end of the category.
    await categoryRow('塗り').click();
    await page.locator('.mgr-main--prompt .mgr-list button', { hasText: '+ 新規' }).click();
    const newEditor = { view: await view(), category: await editor.category.inputValue() };
    await editor.name.fill('ベタ塗り');
    await editor.text.fill('フラットな色で塗って');
    await editorButton('保存').click();
    const createToast = await waitForToast(page, /プロンプト「ベタ塗り」を作成しました/);
    // Duplicate goes right after the original.
    await editorButton('複製').click();
    const duplicateCopyToast = await waitForToast(page, /プロンプト「ベタ塗り のコピー」を作成しました/);
    const afterCreate = { view: await view(), saved: savedOrder() };
    await screenshot('prompt-manager-editor');

    // Reorder within the category: drag the copy above 着彩.
    await promptRow('ベタ塗り のコピー').dragTo(promptRow('着彩'), { targetPosition: { x: 20, y: 4 } });
    const afterReorder = await waitForSavedOrder(o => o.prompts[0] === '塗り/ベタ塗り のコピー');
    // Drop a prompt on another category: it moves to that category's end (the editor follows).
    await promptRow('ベタ塗り のコピー').dragTo(categoryRow('背景'));
    await waitForToast(page, /プロンプト「ベタ塗り のコピー」を「背景」に移しました/);
    const afterMove = { view: await view(), saved: savedOrder(), editorCategory: await editor.category.inputValue() };
    // Reorder categories: drag 背景 above 塗り.
    await categoryRow('背景').dragTo(categoryRow('塗り'), { targetPosition: { x: 20, y: 4 } });
    const afterCategoryOrder = await waitForSavedOrder(o => o.categories[0] === '背景');
    await page.waitForFunction(
      () => document.querySelectorAll('.mgr-sidebar--prompt .mgr-category__name')[1]?.textContent === '背景',
    );

    // Rename a category in place, then into an existing one (merge after a confirmation).
    await categoryRow('塗り').dblclick();
    await page.locator('.mgr-category__input').fill('着色');
    await page.locator('.mgr-category__input').press('Enter');
    await waitForToast(page, /カテゴリー「塗り」を「着色」に変更しました/);
    await categoryRow('背景').dblclick();
    await page.locator('.mgr-category__input').fill('着色');
    await page.locator('.mgr-category__input').press('Enter');
    const mergeMessage = await topModal().locator('.cs-modal__message').textContent();
    await topModal().locator('button', { hasText: 'まとめる' }).click();
    await waitForToast(page, /カテゴリー「背景」を「着色」に変更しました/);
    const afterRename = { view: await view(), saved: savedOrder() };

    // Search within すべて (no drag handles).
    await categoryRow('すべて').click();
    await page.locator('.mgr-main--prompt .mgr-list__search').fill('フラット');
    const searched = await view();
    await page.locator('.mgr-main--prompt .mgr-list__search').fill('');

    // Delete.
    await promptRow('ベタ塗り のコピー').click();
    await editorButton('削除').click();
    const deleteMessage = await topModal().locator('.cs-modal__message').textContent();
    await topModal().locator('button', { hasText: '削除' }).click();
    await waitForToast(page, /プロンプト「ベタ塗り のコピー」を削除しました/);

    // Export (browser download), then import the same file: every name conflicts → スキップ / 名前を変えて追加.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.mgr-sidebar--prompt .mgr-sidebar__action-btn[title="エクスポート"]').click(),
    ]);
    const exportPath = path.join(path.dirname(settingsDir), 'exported-prompts.json');
    await download.saveAs(exportPath);
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
    const importFile = async () => {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator('.mgr-sidebar--prompt .mgr-sidebar__action-btn[title="インポート"]').click(),
      ]);
      await chooser.setFiles(exportPath);
    };
    await importFile();
    const conflictMessage = await topModal().locator('.cs-modal__message').textContent();
    const conflictButtons = await topModal().locator('button').allTextContents();
    await screenshot('prompt-import-conflict', '.cs-modal-overlay--open >> nth=-1');
    await topModal().locator('button', { hasText: 'スキップ' }).click();
    const skipToast = await waitForToast(page, /追加 0 件・上書き 0 件・スキップ 4 件/);
    await importFile();
    await topModal().locator('button', { hasText: '名前を変えて追加' }).click();
    const renameToast = await waitForToast(page, /追加 4 件・上書き 0 件・スキップ 0 件/);
    await page.waitForFunction(() => document.querySelectorAll('.mgr-main--prompt .mgr-item').length === 8);
    const afterImport = { view: await view(), saved: savedOrder() };
    await screenshot('prompt-manager-after-import');

    // Leaving with unsaved changes asks too; back in Normal mode the canvas and the AI panel return.
    await promptRow('着彩').click();
    await editor.text.fill('変更中');
    await page.locator('.left-toolbar__btn[title="Normal Mode"]').click();
    const leaveModeMessage = await topModal().locator('.cs-modal__message').textContent();
    await topModal().locator('button', { hasText: '破棄' }).click();
    await page.waitForTimeout(300);
    const afterLeave = await view();
    await page.waitForFunction(() => !document.querySelector('.toast'), undefined, { timeout: 15000 });
    return {
      opened,
      dirty,
      leaveMessage,
      leaveButtons,
      afterCancel,
      ctrlSToast,
      savedText,
      duplicateToast,
      afterDiscard,
      newEditor,
      createToast,
      duplicateCopyToast,
      afterCreate,
      afterReorder,
      afterMove,
      afterCategoryOrder,
      mergeMessage,
      afterRename,
      searched,
      deleteMessage,
      exported: { format: exported.format, categories: exported.categories, count: exported.prompts.length },
      conflictMessage,
      conflictButtons,
      skipToast,
      renameToast,
      afterImport,
      leaveModeMessage,
      afterLeave,
    };
  });

  await step('10d-character-manager', async () => {
    // Character Manager (docs/specs/character-manager.md): like the Prompt Manager, with images per character
    // (part of the editor's unsaved changes) kept in assets/characters/<id>/, and zip export / import.
    const S = '.mgr-sidebar--character';
    const M = '.mgr-main--character';
    const charactersDir = path.join(path.dirname(settingsDir), 'assets', 'characters');
    const topModal = () => page.locator('.cs-modal-overlay--open').last();
    const exact = (text: string) => new RegExp(`^${text}$`);
    const categoryRow = (label: string) =>
      page
        .locator(`${S} .mgr-category`)
        .filter({ has: page.locator('.mgr-category__name', { hasText: exact(label) }) });
    const characterRow = (name: string) =>
      page.locator(`${M} .mgr-item`).filter({ has: page.locator('.mgr-item__name', { hasText: exact(name) }) });
    const editor = {
      name: page.locator(`${M} .mgr-editor input[type="text"]`).first(),
      category: page.locator(`${M} .mgr-editor .cs-suggest input`),
      text: page.locator(`${M} .mgr-editor textarea:not(.cm-image__text)`),
    };
    const editorButton = (label: string) => page.locator(`${M} .mgr-editor__actions button`, { hasText: label });
    const tiles = page.locator(`${M} .cm-image`);
    const addImages = async (files: { name: string; mimeType: string; buffer: Buffer }[]) => {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator(`${M} .cm-images__add`).click(),
      ]);
      await chooser.setFiles(files);
    };
    const view = () =>
      page.evaluate(
        ([S, M]) => {
          const shown = (sel: string) => {
            const el = document.querySelector(sel);
            return !!el && (el as HTMLElement).getClientRects().length > 0;
          };
          const row = (e: Element) => {
            if (e.classList.contains('mgr-list__group')) return `## ${e.textContent}`;
            if (!e.classList.contains('mgr-item')) return `(${e.textContent})`;
            const active = e.classList.contains('mgr-item--active') ? '>' : '';
            const sortable = e.classList.contains('mgr-item--sortable') ? '⋮' : '';
            const thumb = e.querySelector('img.cm-thumb') ? '[img]' : '[icon]';
            return `${active}${sortable}${thumb}${e.querySelector('.mgr-item__name')?.textContent}`;
          };
          return {
            title: document.querySelector(`${S} .mgr-sidebar__title`)?.textContent,
            categories: Array.from(document.querySelectorAll(`${S} .mgr-category`)).map(e => [
              e.querySelector('.mgr-category__name')?.textContent,
              e.querySelector('.mgr-category__count')?.textContent,
              e.classList.contains('mgr-category--active'),
            ]),
            list: Array.from(document.querySelectorAll(`${M} :is(.mgr-list__group, .mgr-item, .mgr-list__empty)`)).map(
              row,
            ),
            editor: shown(`${M} .mgr-editor__form`)
              ? {
                  title: document.querySelector(`${M} .mgr-editor__title`)?.textContent,
                  dirty: shown(`${M} .mgr-editor__dirty`),
                  icon: document.querySelector(`${M} .cm-icon__preview img`) ? 'image' : 'none',
                  iconButtons: Array.from(document.querySelectorAll<HTMLButtonElement>(`${M} .cm-icon button`))
                    .filter(b => b.getClientRects().length > 0)
                    .map(b => `${b.textContent}${b.disabled ? ' (disabled)' : ''}`),
                  images: document.querySelector(`${M} .cm-images .cs-field__label`)?.textContent,
                  tiles: Array.from(document.querySelectorAll(`${M} .cm-image`)).map(t =>
                    t.querySelector('.cm-image__new') ? 'new' : 'saved',
                  ),
                  buttons: Array.from(document.querySelectorAll<HTMLElement>(`${M} .mgr-editor__actions button`))
                    .filter(b => b.getClientRects().length > 0)
                    .map(b => b.textContent),
                }
              : document.querySelector(`${M} .mgr-editor__empty`)?.textContent,
            archivesShown: shown('.layer-panel'),
            canvasShown: shown('.canvas-area'),
            aiPanelShown: shown('.ai-panel'),
            promptManagerShown: shown('.mgr-sidebar--prompt'),
            activeModes: Array.from(document.querySelectorAll('.left-toolbar__btn--active')).map(e =>
              e.getAttribute('title'),
            ),
          };
        },
        [S, M],
      );
    const saved = () =>
      JSON.parse(fs.readFileSync(path.join(charactersDir, 'characters.json'), 'utf-8')) as {
        categories: string[];
        characters: {
          id: string;
          name: string;
          category: string;
          text: string;
          images: string[];
          image_texts: Record<string, string>;
          icon: string | null;
        }[];
      };
    /** The saved characters with the number of files actually in each folder. */
    const savedSummary = () => {
      const data = saved();
      return {
        categories: data.categories,
        characters: data.characters.map(c => {
          const folder = path.join(charactersDir, c.id);
          const files = fs.existsSync(folder) ? fs.readdirSync(folder).length : 0;
          const icon = c.icon ? 'icon' : 'no icon';
          return `${c.category || '-'}/${c.name}: images ${c.images.length}, ${icon}, files ${files}, text ${JSON.stringify(c.text)}`;
        }),
      };
    };
    const red = await makePng(page, 40, 60);
    const blue = await makePng(page, 60, 40);
    // Face detection answers with two faces in the image's pixels (the real model is never used here).
    const detected: number[] = [];
    const stubFaces = (route: Route) => {
      detected.push(route.request().postDataBuffer()?.length ?? 0);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify({
          faces: [
            { x: 10, y: 8, width: 16, height: 20, score: 0.9 },
            { x: 2, y: 40, width: 8, height: 8, score: 0.4 },
          ],
          warnings: [],
        }),
      });
    };
    await page.route(/\/api\/characters\/detect-faces$/, stubFaces);
    const cropper = page.locator('.icon-cropper-overlay.cs-modal-overlay--open');
    const cropperState = () =>
      page.evaluate(() => {
        const frame = document.querySelector<HTMLElement>('.icon-cropper__frame');
        return {
          status: document.querySelector('.icon-cropper__status')?.textContent,
          sources: Array.from(document.querySelectorAll('.icon-cropper__source')).map(b =>
            b.classList.contains('icon-cropper__source--active') ? 'active' : '-',
          ),
          faces: document.querySelectorAll('.icon-cropper__face').length,
          frame: frame && { left: frame.style.left, top: frame.style.top, size: frame.style.width },
        };
      });
    /** Width and height of a PNG file (IHDR). */
    const pngSize = (file: string) => {
      const data = fs.readFileSync(file);
      return [data.readUInt32BE(16), data.readUInt32BE(20)];
    };

    await page.locator('.left-toolbar__btn[title="Character Manager"]').click();
    await page.waitForFunction(M => !!document.querySelector(`${M} .mgr-list__empty`), M);
    const opened = await view();
    const folderCreated = fs.existsSync(charactersDir);

    // New character with two images (a text file is refused); images are unsaved until 保存.
    await page.locator(`${M} .mgr-list button`, { hasText: '+ 新規' }).click();
    await editor.name.fill('花子');
    await editor.category.fill('主要');
    await editor.text.fill('黒髪ボブ、赤いリボン');
    await addImages([
      { name: 'front.png', mimeType: 'image/png', buffer: red },
      { name: 'side.png', mimeType: 'image/png', buffer: blue },
      { name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('memo') },
    ]);
    const refusedToast = await waitForToast(page, /PNG \/ JPEG \/ WebP 以外の 1 件は追加しませんでした/);
    // No icon yet: the icon cropper opens on the first added image, with the frame on the best face.
    await cropper.waitFor();
    await page.waitForFunction(() =>
      document.querySelector('.icon-cropper__status')?.textContent?.includes('検出しました'),
    );
    const cropperOpened = await cropperState();
    await screenshot('icon-cropper', '.cs-modal-overlay--open >> nth=-1');
    // Drag the frame 35px to the right (it stops at the image edge), then pick the other face.
    const frameBox = (await page.locator('.icon-cropper__frame').boundingBox())!;
    await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(frameBox.x + frameBox.width / 2 + 35, frameBox.y + frameBox.height / 2, { steps: 5 });
    await page.mouse.up();
    const afterDrag = await cropperState();
    await page.locator('.icon-cropper__face').nth(1).click();
    const afterFaceClick = await cropperState();
    await cropper.locator('button', { hasText: '決定' }).click();
    await cropper.waitFor({ state: 'detached' }).catch(() => cropper.waitFor({ state: 'hidden' }));
    const newEditor = await view();
    await screenshot('character-manager-new');
    await editorButton('保存').click();
    const createToast = await waitForToast(page, /キャラクター「花子」を作成しました/);
    const afterCreate = { view: await view(), saved: savedSummary() };
    const hanako = saved().characters[0];
    const icon = {
      cropperOpened,
      afterDrag,
      afterFaceClick,
      detectRequests: detected.length,
      fileSize: pngSize(path.join(charactersDir, hanako.id, hanako.icon!)),
      notAnImage: !hanako.images.includes(hanako.icon!),
    };

    // While detecting: an hourglass over the image, no other operation; 中断 stops it and the frame stays in
    // the middle for manual cropping. The detection is held until the browser cancels it.
    let releaseDetection = () => {};
    const heldDetection = new Promise<void>(resolve => (releaseDetection = resolve));
    const holdFaces = async (route: Route) => {
      await heldDetection;
      await route.abort().catch(() => {});
    };
    await page.unroute(/\/api\/characters\/detect-faces$/, stubFaces);
    await page.route(/\/api\/characters\/detect-faces$/, holdFaces);
    const busyState = () =>
      page.evaluate(() => ({
        busy: (document.querySelector('.icon-cropper__busy') as HTMLElement | null)?.hidden === false,
        sourcesDisabled: Array.from(document.querySelectorAll<HTMLButtonElement>('.icon-cropper__source')).map(
          b => b.disabled,
        ),
        confirmDisabled: Array.from(document.querySelectorAll<HTMLButtonElement>('.icon-cropper-overlay button')).find(
          b => b.textContent === '決定',
        )?.disabled,
        status: document.querySelector('.icon-cropper__status')?.textContent,
        frame: document.querySelector<HTMLElement>('.icon-cropper__frame')?.style.left,
      }));
    await page.locator(`${M} .cm-icon button`, { hasText: 'アイコンを変更' }).click();
    await page.locator('.icon-cropper__busy:not([hidden])').waitFor();
    const whileDetecting = await busyState();
    await screenshot('icon-cropper-detecting', '.cs-modal-overlay--open >> nth=-1');
    // A drag on the image does nothing while the hourglass covers it.
    const busyBox = (await page.locator('.icon-cropper__stage').boundingBox())!;
    await page.mouse.move(busyBox.x + busyBox.width / 2, busyBox.y + busyBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(busyBox.x + busyBox.width / 2 + 40, busyBox.y + busyBox.height / 2, { steps: 4 });
    await page.mouse.up();
    const afterBusyDrag = await busyState();
    await page.locator('.icon-cropper__busy button', { hasText: '中断' }).click();
    await page.waitForFunction(() => document.querySelector('.icon-cropper__status')?.textContent?.includes('中断'));
    const afterAbort = await busyState();
    releaseDetection();
    await cropper.locator('button', { hasText: 'キャンセル' }).click();
    await page.unroute(/\/api\/characters\/detect-faces$/, holdFaces);
    await page.route(/\/api\/characters\/detect-faces$/, stubFaces);
    const detectionBusy = {
      whileDetecting,
      afterBusyDrag,
      afterAbort,
      iconUnchanged: saved().characters[0].icon === hanako.icon,
      editorAfterCancel: (await view()).editor,
    };

    // Reorder the images (drag the second onto the left half of the first), remove one, Ctrl+S.
    await tiles.nth(1).dragTo(tiles.nth(0), { targetPosition: { x: 4, y: 50 } });
    const reordered = (await view()).editor;
    await tiles.nth(1).locator('.cm-image__remove').click();
    await editor.text.press('Control+s');
    await waitForToast(page, /キャラクター「花子」を保存しました/);
    const afterEdit = saved().characters[0];
    const imageEdit = {
      reordered,
      keptSecondAsFirst: afterEdit.images[0] === hanako.images[1],
      removedFileGone: !fs.existsSync(path.join(charactersDir, hanako.id, hanako.images[0])),
      saved: savedSummary(),
    };
    // Add an image back for the rest of the scenario.
    await addImages([{ name: 'front.png', mimeType: 'image/png', buffer: red }]);
    await editorButton('保存').click();
    await waitForToast(page, /キャラクター「花子」を保存しました/);

    // Each image has its own text, saved with 保存 like the images.
    // (after the save has refreshed the editor: the added image is no longer 新規)
    await page.waitForFunction(M => !document.querySelector(`${M} .cm-image__new`), M);
    await tiles.nth(1).locator('.cm-image__text').fill('正面を向いた全身');
    const dirtyAfterImageText = (await view()).editor;
    const valuesAfterFill = await tiles
      .locator('.cm-image__text')
      .evaluateAll(els => els.map(e => (e as HTMLTextAreaElement).value));
    await editorButton('保存').click();
    await waitForToast(page, /キャラクター「花子」を保存しました/);
    const withImageText = saved().characters[0];
    const imageTexts = {
      dirtyAfterImageText,
      valuesAfterFill,
      saved: withImageText.image_texts,
      onSecondImage: withImageText.image_texts[withImageText.images[1]],
      shown: await tiles.locator('.cm-image__text').evaluateAll(els => els.map(e => (e as HTMLTextAreaElement).value)),
    };

    // Clicking an image shows it large in a window, only to look at it; Esc closes it and nothing changes.
    await tiles.nth(1).locator('img').click();
    await page.waitForSelector('.cs-image-viewer');
    const viewer = {
      title: await page.locator('.cs-image-viewer__title').textContent(),
      imageBox: await page.locator('.cs-image-viewer__img').boundingBox(),
    };
    await screenshot('character-image-viewer');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.cs-image-viewer', { state: 'detached' });
    const afterViewer = { editor: (await view()).editor, modeStillCharacter: (await view()).activeModes };
    // A click outside the image closes it too.
    await tiles.nth(0).locator('img').click();
    await page.waitForSelector('.cs-image-viewer');
    await page.mouse.click(5, 5);
    await page.waitForSelector('.cs-image-viewer', { state: 'detached' });

    // A text-only character; leaving unsaved changes asks first.
    await page.locator(`${M} .mgr-list button`, { hasText: '+ 新規' }).click();
    await editor.name.fill('太郎');
    await editor.text.fill('学ラン、眼鏡');
    await characterRow('花子').click();
    const leaveMessage = await topModal().locator('.cs-modal__message').textContent();
    await topModal().locator('button', { hasText: '保存' }).click();
    await waitForToast(page, /キャラクター「太郎」を作成しました/);

    // Duplicate copies the images; a duplicate name only warns.
    await characterRow('花子').click();
    await editorButton('複製').click();
    await waitForToast(page, /キャラクター「花子 のコピー」を作成しました/);
    await editor.name.fill('太郎');
    await editorButton('保存').click();
    const duplicateNameToast = await waitForToast(page, /同じ名前のキャラクター「太郎」が登録されています/);
    await editor.name.fill('花子 のコピー');
    const afterDuplicate = { view: await view(), saved: savedSummary() };
    await screenshot('character-manager-editor');

    // Rename the category, then delete the copy (its folder goes too).
    await categoryRow('主要').dblclick();
    await page.locator('.mgr-category__input').fill('メイン');
    await page.locator('.mgr-category__input').press('Enter');
    await waitForToast(page, /カテゴリー「主要」を「メイン」に変更しました/);
    const copy = saved().characters.find(c => c.name === '花子 のコピー')!;
    await characterRow('花子 のコピー').click();
    await editorButton('削除').click();
    const deleteMessage = await topModal().locator('.cs-modal__message').textContent();
    await topModal().locator('button', { hasText: '削除' }).click();
    await waitForToast(page, /キャラクター「花子 のコピー」を削除しました/);
    const afterDelete = {
      view: await view(),
      saved: savedSummary(),
      copyFolderGone: !fs.existsSync(path.join(charactersDir, copy.id)),
    };

    // Export (zip download), then import it again: every name conflicts → 名前を変えて追加.
    // (The double click on 主要 also selected it; show すべて again.)
    await categoryRow('すべて').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator(`${S} .mgr-sidebar__action-btn[title="エクスポート"]`).click(),
    ]);
    const exportToast = await waitForToast(page, /キャラクター 2 件を .* に書き出しました/);
    const exportPath = path.join(path.dirname(settingsDir), 'exported-characters.zip');
    await download.saveAs(exportPath);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator(`${S} .mgr-sidebar__action-btn[title="インポート"]`).click(),
    ]);
    await chooser.setFiles(exportPath);
    const conflictMessage = await topModal().locator('.cs-modal__message').textContent();
    await topModal().locator('button', { hasText: '名前を変えて追加' }).click();
    const importToast = await waitForToast(page, /追加 2 件・上書き 0 件・スキップ 0 件/);
    await page.waitForFunction(M => document.querySelectorAll(`${M} .mgr-item`).length === 4, M);
    const afterImport = { view: await view(), saved: savedSummary() };
    await screenshot('character-manager-after-import');

    // Back to Normal mode.
    await page.locator('.left-toolbar__btn[title="Normal Mode"]').click();
    await page.waitForTimeout(300);
    const afterLeave = await view();
    await page.waitForFunction(() => !document.querySelector('.toast'), undefined, { timeout: 15000 });

    // From Nano Banana画像生成: 花子's images become Character reference images described with the name / text;
    // 太郎 (no images) appends the text to the prompt. Everything is put back afterwards for the next scenarios.
    const win = '.tool-window';
    await openNanoBananaWithoutOriginal(page);
    const promptArea = page.locator(`${win} .nbp-prompt textarea`);
    const promptBefore = await promptArea.inputValue();
    const openPicker = async () => {
      await page.locator(`${win} button[title="登録したキャラクターから追加"]`).click();
      await page.waitForFunction(() => {
        const list = document.querySelector('.cs-modal-overlay--open .prompt-library');
        return !!list && !list.textContent?.includes('読み込み中');
      });
    };
    const useCharacter = async (name: string) => {
      await topModal()
        .locator('.prompt-library__item')
        .filter({ has: page.locator('.prompt-library__name', { hasText: exact(name) }) })
        .locator('button', { hasText: '使う' })
        .click();
    };
    await openPicker();
    const pickerItems = await page.$$eval('.cs-modal-overlay--open .prompt-library__item', els =>
      els.map(e => [
        e.querySelector('.prompt-library__name')?.textContent,
        e.querySelector('.prompt-library__category')?.textContent,
        e.querySelector('.character-library__count')?.textContent,
        !!e.querySelector('img.character-library__thumb'),
      ]),
    );
    await screenshot('character-picker', '.cs-modal-overlay--open >> nth=-1');
    await useCharacter('花子');
    const usedToast = await waitForToast(page, /キャラクター「花子」の画像 2 枚を参照画像に追加しました/);
    const cards = await page.$$eval(`${win} .ref-list .ref-card`, els =>
      els.map(el => ({
        type: el.querySelector<HTMLSelectElement>('.ref-card__type')?.value ?? null,
        description: el.querySelector<HTMLTextAreaElement>('.ref-card__description')?.value ?? null,
      })),
    );
    await openPicker();
    await useCharacter('太郎');
    const textToast = await waitForToast(page, /キャラクター「太郎」の本文をプロンプトに追加しました/);
    const promptAfter = await promptArea.inputValue();
    await screenshot('character-in-tool', win);
    while (await page.locator(`${win} .ref-list .ref-card__remove`).count()) {
      await page.locator(`${win} .ref-list .ref-card__remove`).first().click();
    }
    await promptArea.fill(promptBefore);
    await closeToolWindow(page);
    await page.unroute(/\/api\/characters\/detect-faces$/, stubFaces);
    await page.waitForFunction(() => !document.querySelector('.toast'), undefined, { timeout: 15000 });

    return {
      opened,
      folderCreated,
      refusedToast,
      newEditor,
      createToast,
      afterCreate,
      imageEdit,
      imageTexts,
      viewer,
      afterViewer,
      leaveMessage,
      duplicateNameToast,
      afterDuplicate,
      deleteMessage,
      afterDelete,
      exportToast,
      conflictMessage,
      importToast,
      afterImport,
      afterLeave,
      icon,
      detectionBusy,
      tool: {
        pickerItems,
        usedToast,
        cards,
        textToast,
        promptAdded: promptAfter.slice(promptBefore.trimEnd().length),
      },
    };
  });

  await step('11-tool-error', async () => {
    // E2E has no API key, so the run fails: an error toast that stays until closed, and nothing
    // is written to the archives (no error.txt, no "_error" archive).
    // The window closes as soon as the run starts (docs/specs/ai-panel.md 「ツールの実行」); the request is
    // held meanwhile, so the run is still going when another tool is clicked: that only warns.
    let releaseRun = () => {};
    const held = new Promise<void>(resolve => (releaseRun = resolve));
    await page.route('**/api/nano-banana-pro**', async route => {
      await held;
      await route.continue();
    });
    await clickTool(page, 'Nano Banana画像生成');
    await page.waitForSelector('.tool-window');
    await page.locator('.tool-window .tool-window__run').click();
    await page.locator('.tool-window').waitFor({ state: 'detached', timeout: 3000 });
    const statusWhileRunning = await page.locator('.statusbar__left').innerText();
    const toolListBusy = (await page.locator('.ai-panel__list--busy').count()) === 1;
    await clickTool(page, '背景除去');
    const busyToast = await waitForToast(page, /背景除去: 「Nano Banana画像生成」の実行が終わってから実行してください/);
    const windowOpenedWhileBusy = (await page.locator('.tool-window').count()) > 0;
    await screenshot('tool-running');
    releaseRun();
    await waitForToast(page, /Nano Banana画像生成の実行に失敗しました/);
    await page.unroute('**/api/nano-banana-pro**');
    const toolListBusyAfterRun = (await page.locator('.ai-panel__list--busy').count()) === 1;
    await page.waitForTimeout(4500); // longer than the 4s auto-hide of other toasts
    const toasts = await toastStack(page);
    const errorToast = page.locator('.toast--error').last();
    await withVisibleToasts(page, async () => {
      await screenshot('error-toast', '.toast-stack');
      await errorToast.locator('.toast__close').click();
    });
    await errorToast.waitFor({ state: 'detached' });
    return {
      statusWhileRunning,
      toolListBusy,
      busyToast,
      windowOpenedWhileBusy,
      toolListBusyAfterRun,
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
    await page.locator('.tool-window').waitFor({ state: 'detached' }); // closes once the run starts
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
    // Batch mode opens with a notice that it is being reworked.
    const notice = await waitForToast(page, /Batch モードは現在修正中です/);
    await archiveItem(page, /^sub$/).click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLCanvasElement>('.canvas-area canvas')).some(c => c.width === 1660),
    );
    await page.waitForTimeout(500);
    const canvas = await canvasState(page);
    await screenshot('batch-mode');
    await setMode(page, 'Normal');
    return { notice, canvas };
  });

  await step('13b-normal-after-modes', async () => {
    // Back from Batch: the selected folder is shown the Normal way (no image, not the old grid).
    const afterBatch = await waitForEmptyMessage(page, /フォルダ「sub」/);
    await screenshot('normal-after-batch', '.canvas-area');

    // Expanding a folder keeps the selection.
    await expandFolder(page, /^sub$/);
    const keptOnExpand = (await archiveTree(page)).filter(r => r.state.includes('active')).map(r => r.name);

    // A panel of a コマ分割 folder: コマ結合 targets that folder.
    await (await childItem(page, 'e2e-panels', 'sub')).click(); // deselect the folder
    await archiveItem(page, '01.png').click();
    await waitForCanvasWidth(page, 150);
    const mergeCard = await toolCard(page, 'コマ結合');

    // Expanding / collapsing another folder keeps the image.
    await expandFolder(page, /e2e-image$/);
    await collapseFolder(page, /e2e-image$/);
    const keptOnOtherFolder = (await canvasState(page)).canvases[0];

    // Parallel with a larger image as R, then back: the canvas is the selected image's size again.
    await expandFolder(page, /e2e-image$/);
    await setMode(page, 'Parallel');
    await layerBox(page, 'e2e-image.png', 1).click();
    await waitForCanvasWidth(page, 640);
    await page.waitForTimeout(300);
    const parallelSize = (await canvasState(page)).canvases.map(c => `${c.w}x${c.h}`);
    await setMode(page, 'Normal');
    await page.waitForSelector('aside.ai-panel', { state: 'visible' });
    await waitForCanvasWidth(page, 150);
    await page.waitForTimeout(300);
    const afterParallel = await canvasState(page);
    await screenshot('normal-after-parallel', '.canvas-area');
    // Checking L / R did not move the save folder: コマ結合 still targets the selection.
    const mergeCardAfterParallel = await toolCard(page, 'コマ結合');

    // Collapsing the folder of the shown image empties the canvas.
    await collapseFolder(page, /^sub$/);
    const collapsed = await waitForEmptyMessage(page, /^ARCHIVES から画像を選択してください$/);
    return {
      afterBatch,
      keptOnExpand,
      mergeCard,
      keptOnOtherFolder: { size: `${keptOnOtherFolder.w}x${keptOnOtherFolder.h}`, title: keptOnOtherFolder.title },
      parallelSize,
      afterParallel: {
        size: afterParallel.canvases.map(c => `${c.w}x${c.h}`),
        zoom: afterParallel.zoomLabel,
        emptyMessage: afterParallel.emptyMessage,
      },
      mergeCardAfterParallel,
      collapsed,
    };
  });

  await step('13c-parallel-mode', async () => {
    const toggles = page.locator('.canvas-toolbar__group').first().locator('.toggle');
    const drag = async (x: number, y: number, dx: number, dy: number) => {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(150);
    };
    const waitForRightTitle = (title: string) =>
      page.waitForFunction(
        title => document.querySelector<HTMLCanvasElement>('.canvas-split__pane--right canvas')?.title === title,
        title,
        { timeout: 10000 },
      );

    const waitForPaneNotice = (side: 'left' | 'right', shown: boolean) =>
      page.waitForFunction(
        ({ side, shown }) =>
          (getComputedStyle(document.querySelector(`.canvas-split__pane--${side} .canvas-split__pane-empty`)!)
            .display !==
            'none') ===
          shown,
        { side, shown },
        { timeout: 10000 },
      );

    // L: the 640x480 image; R: the 150x200 panel (actual pixel ratio, both centred in the 640x480 box).
    // Both start empty even with an image selected (the selection is not shown in Parallel mode).
    await archiveItem(page, 'e2e-image.png').click();
    await waitForCanvasWidth(page, 640);
    await setMode(page, 'Parallel');
    await waitForPaneNotice('left', true);
    await page.waitForTimeout(300);
    const started = { ...(await parallelState(page)), layers: await layerColumns(page) };
    await screenshot('parallel-empty', '.canvas-area');
    await layerBox(page, 'e2e-image.png', 0).click();
    await waitForPaneNotice('left', false);
    await expandFolder(page, /^sub$/);
    await layerBox(page, '01.png', 1).click();
    await waitForRightTitle('150 x 200px');
    await page.waitForTimeout(300);
    const sideBySide = { ...(await parallelState(page)), layers: await layerColumns(page) };
    await screenshot('parallel-side-by-side', '.canvas-area');

    // Dragging moves both images the same way; the panes and the boundary between them stay.
    const right = (await page.locator('.canvas-split__pane--right').boundingBox())!;
    await drag(right.x + right.width / 2, right.y + right.height / 2, -120, 60);
    const dragged = await parallelState(page);
    await screenshot('parallel-dragged', '.canvas-area');
    await page.locator('.canvas-zoom-bar button[title="Fit to Screen"]').click();
    await page.waitForTimeout(200);

    // Unchecking R: a notice in the right pane, never the left image.
    await layerBox(page, '01.png', 1).click();
    await waitForPaneNotice('right', true);
    const rightEmpty = { ...(await parallelState(page)), rightPixels: (await canvasState(page)).canvases[1]?.pixels };
    await screenshot('parallel-right-empty', '.canvas-area');

    // Row clicks (a text file, an image) change neither the panes nor L / R; the same image can be both L and R.
    await archiveItem(page, 'notes.txt').click();
    await archiveItem(page, '02.png').click();
    await page.waitForTimeout(300);
    const afterRowClicks = { ...(await parallelState(page)), layers: await layerColumns(page) };
    await layerBox(page, 'e2e-image.png', 1).click();
    await waitForRightTitle('640 x 480px');
    const sameImage = await layerColumns(page);

    // Slider: the panes are stacked; the divider (fixed to the screen) clips the front one.
    await layerBox(page, '01.png', 1).click();
    await waitForRightTitle('150 x 200px');
    await toggles.nth(0).click();
    await page.waitForTimeout(300);
    const slider = await parallelState(page);
    await screenshot('parallel-slider', '.canvas-area');
    const split = (await page.locator('.canvas-split').boundingBox())!;
    const handle = (await page.locator('.canvas-split__divider-handle').boundingBox())!;
    const handleX = handle.x + handle.width / 2;
    await drag(handleX, handle.y + handle.height / 2, split.x + split.width * 0.3 - handleX, 0);
    const sliderMoved = await parallelState(page);
    await drag(split.x + split.width * 0.7, split.y + split.height / 2, -100, 50); // pan on the back pane
    const sliderDragged = await parallelState(page);
    await screenshot('parallel-slider-dragged', '.canvas-area');
    await toggles.nth(1).click();
    await page.waitForTimeout(200);
    const transposed = await parallelState(page);
    await screenshot('parallel-slider-transpose', '.canvas-area');
    await toggles.nth(2).click();
    await page.waitForTimeout(200);
    const flipped = await parallelState(page);
    await screenshot('parallel-slider-flip', '.canvas-area');

    // Deleting is allowed: R (01.png, in the deleted archive) is dropped; Ctrl+Z restores the archive.
    const deleteEnabled = await page
      .locator(`${LEFT_PANEL} .layer-panel__action-btn[title="アーカイブ削除"]`)
      .isEnabled();
    await archiveItem(page, 'e2e-panels').click();
    await page.locator(`${LEFT_PANEL} .layer-panel__action-btn[title="アーカイブ削除"]`).click();
    await waitForToast(page, /削除/);
    await waitForPaneNotice('right', true);
    await page.waitForTimeout(500);
    const afterDelete = { ...(await parallelState(page)), layers: await layerColumns(page) };
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      panel =>
        Array.from(document.querySelectorAll(`${panel} .layer-item__name`)).some(e => e.textContent === 'e2e-panels'),
      LEFT_PANEL,
    );

    // Back in Normal mode: the selection is shown again (nothing selected after the delete).
    await setMode(page, 'Normal');
    await page.waitForSelector('aside.ai-panel', { state: 'visible' });
    await page.waitForTimeout(300);
    const normal = { ...(await parallelState(page)), layers: await layerColumns(page) };
    await waitForEmptyMessage(page, /^ARCHIVES から画像を選択してください$/);
    // Leave the tree as the next step expects (panel folder collapsed).
    await expandFolder(page, 'e2e-panels');
    await collapseFolder(page, /^sub$/).catch(() => undefined);
    return {
      started,
      sideBySide,
      dragged,
      rightEmpty,
      afterRowClicks,
      sameImage,
      slider,
      sliderMoved,
      sliderDragged,
      transposed,
      flipped,
      deleteEnabled,
      afterDelete,
      normal,
    };
  });

  await step('13d-overlay-layers', async () => {
    // U / T are chosen with the ARCHIVES checkboxes only (docs/specs/canvas.md 「Overlay モード」).
    const box = (name: string, layer: 'under' | 'top') => layerBox(page, name, layer === 'under' ? 0 : 1);
    const checked = async () => {
      const [u, t] = (await layerColumns(page)).columns;
      return { u, t };
    };
    const summary = async () => {
      const c = await canvasState(page);
      return {
        size: c.canvases.filter(x => x.visible).map(x => `${x.w}x${x.h}`),
        pixels: c.canvases[0]?.pixels,
        emptyMessage: c.emptyMessage,
        emptyHintVisible: await page.locator('.canvas-empty__hint').isVisible(),
        textVisible: c.textOverlays.some(o => o.visible),
        zoomLabel: c.zoomLabel,
        checked: await checked(),
      };
    };
    /** Whether the canvas swallows an arrow key (it only does while T is selected). */
    const arrowPrevented = () =>
      page.evaluate(() => {
        const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
        document.body.dispatchEvent(ev);
        return ev.defaultPrevented;
      });

    // Entering with one image selected: it becomes U, T is empty, the right sidebar closes.
    await archiveItem(page, 'e2e-image.png').click();
    await waitForCanvasWidth(page, 640);
    await setMode(page, 'Overlay');
    await page.waitForTimeout(300);
    const started = { ...(await summary()), aiPanelVisible: await page.locator('aside.ai-panel').isVisible() };
    await screenshot('overlay-start');

    // T: the 150x200 panel, centred over U.
    await expandFolder(page, /^sub$/);
    await box('01.png', 'top').click();
    await page.waitForFunction(() => document.querySelectorAll('.layer-item__layer-cb--checked').length === 2);
    await page.waitForTimeout(300);
    const withTop = await summary();
    await screenshot('overlay-u-t', '.canvas-area');

    // Clicking rows (a text file, another image) changes neither U / T nor the canvas.
    await archiveItem(page, 'notes.txt').click();
    await page.waitForTimeout(300);
    const afterTextClick = await summary();
    await archiveItem(page, '02.png').click();
    await page.waitForTimeout(300);
    const afterImageClick = await summary();

    // Double click selects T; arrow keys move it (Shift = 10px) and are only taken while T is selected.
    const arrowFreeBefore = await arrowPrevented();
    const canvasBox = (await page.locator('.canvas-split__pane--left canvas').boundingBox())!;
    await page.mouse.dblclick(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await page.waitForTimeout(150);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight'); // 60px
    await page.waitForTimeout(150);
    const moved = await summary();
    const arrowTakenWhileSelected = await arrowPrevented();
    await screenshot('overlay-t-moved', '.canvas-area');
    await page.mouse.click(canvasBox.x + 4, canvasBox.y + 4); // outside T: deselects it
    await page.waitForTimeout(150);
    const arrowFreeAfter = await arrowPrevented();

    // U on the T row: the same image cannot be both, so T is cleared.
    await box('01.png', 'under').click();
    await waitForCanvasWidth(page, 150);
    await page.waitForTimeout(300);
    const underOnTopRow = await summary();

    // Dropping an image file imports nothing in Overlay mode.
    const archivesBefore = (await archiveTree(page)).length;
    await dropTestImage(page, 'overlay-drop.png', 120, 90);
    const dropToast = await waitForToast(page, /Overlay View では画像を取り込めません/);
    await page.waitForTimeout(500);
    const archivesAfterDrop = (await archiveTree(page)).length;

    // Unchecking U leaves nothing: the canvas asks for U / T (no drop hint).
    await box('01.png', 'under').click();
    await waitForEmptyMessage(page, /U \/ T 列/);
    const nothing = await summary();
    await screenshot('overlay-empty', '.canvas-area');

    // Back in Normal mode: the current selection (02.png) is shown and the tools come back.
    await setMode(page, 'Normal');
    await page.waitForSelector('aside.ai-panel', { state: 'visible' });
    await page.waitForTimeout(300);
    const normal = { ...(await summary()), aiPanelVisible: await page.locator('aside.ai-panel').isVisible() };

    // Leave the tree as the next step expects (nothing selected, panel folder collapsed).
    await archiveItem(page, '02.png').click();
    await waitForEmptyMessage(page, /^ARCHIVES から画像を選択してください$/);
    await collapseFolder(page, /^sub$/);
    return {
      started,
      withTop,
      rowClicksKeepCanvas:
        JSON.stringify(afterTextClick.pixels) === JSON.stringify(withTop.pixels) &&
        JSON.stringify(afterImageClick.pixels) === JSON.stringify(withTop.pixels),
      afterTextClick,
      afterImageClick,
      moved: { ...moved, changed: JSON.stringify(moved.pixels) !== JSON.stringify(withTop.pixels) },
      arrowFreeBefore,
      arrowTakenWhileSelected,
      arrowFreeAfter,
      underOnTopRow,
      dropToast,
      dropImportedNothing: archivesBefore === archivesAfterDrop,
      nothing,
      normal,
    };
  });

  await step('14-delete-and-undo', async () => {
    await archiveItem(page, 'e2e-panels').click();
    await page.locator(`${LEFT_PANEL} .layer-panel__action-btn[title="アーカイブ削除"]`).click();
    const deleteToast = await waitForToast(page, /削除/);
    await page.waitForTimeout(500);
    const afterDelete = await archiveTree(page);
    // The selection is gone: the canvas asks for an image again.
    const emptyAfterDelete = (await canvasState(page)).emptyMessage;
    await screenshot('canvas-empty', '.canvas-area');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      panel =>
        Array.from(document.querySelectorAll(`${panel} .layer-item__name`)).some(e => e.textContent === 'e2e-panels'),
      LEFT_PANEL,
    );
    return { deleteToast, afterDelete, emptyAfterDelete, afterUndo: await archiveTree(page) };
  });

  await step('15-dialogs', async () => {
    // The settings window (gear icon; Ctrl+B opens the 背景色指定 page) lists its pages on the left
    // (docs/specs/app-shell.md 「設定ウィンドウ」). A background swatch applies and saves the colour at once.
    const win = '.settings-window';
    const pageState = async () => ({
      active: await page.locator(`${win} .settings-window__nav-item--active`).textContent(),
      title: await page.locator(`${win} .settings-window__page-title`).textContent(),
      sections: await page.locator(`${win} .settings-window__section-title`).allTextContents(),
    });
    const selectedSwatch = () => page.locator(`${win} .bg-swatch--selected`).getAttribute('title');
    const isOpen = async () => (await page.locator('.settings-window-overlay--open').count()) === 1;
    const closeWindow = async () => {
      await page.locator(`${win} .settings-window__close`).click();
      await page.waitForSelector(win, { state: 'detached' });
    };
    const savedBgColor = async () => {
      const userFile = path.join(settingsDir, 'user_settings.json');
      for (let i = 0; i < 30; i++) {
        if (fs.existsSync(userFile)) {
          const value = (JSON.parse(fs.readFileSync(userFile, 'utf-8')) as Record<string, string>).canvas_bgColor;
          if (value) return value;
        }
        await page.waitForTimeout(100);
      }
      return null;
    };

    // Gear: opens on the first page (API).
    await page.locator('.topbar__action-btn').first().click();
    await page.waitForSelector(win);
    await page.waitForFunction(() => !!document.querySelector('.settings-window__status')?.textContent);
    const fromGear = {
      nav: await page.locator(`${win} .settings-window__nav-item`).allTextContents(),
      ...(await pageState()),
      keyStatus: await page.locator(`${win} .settings-window__status`).textContent(),
      saveDisabled: await page.locator(win).getByRole('button', { name: '保存', exact: true }).isDisabled(),
    };
    await screenshot('settings-api');
    await page.locator(`${win} .settings-window__nav-item`, { hasText: '背景色指定' }).click();
    const displayPage = { ...(await pageState()), selected: await selectedSwatch() };
    await page.keyboard.press('Escape');
    await page.waitForSelector(win, { state: 'detached' });

    await archiveItem(page, /e2e-image$/).click();
    await expandFolder(page, /e2e-image$/);
    await archiveItem(page, 'e2e-image.png').click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLCanvasElement>('.canvas-area canvas')).some(c => c.width === 640),
    );
    // Ctrl+B: opens on the 背景色指定 page.
    await page.keyboard.press('Control+b');
    await page.waitForSelector(win);
    const fromShortcut = await pageState();
    await page.locator(`${win} button[title="Black"]`).click();
    const toast = await waitForToast(page, /背景色を/);
    const afterPick = {
      windowOpen: await isOpen(),
      selected: await selectedSwatch(),
      current: await page.locator(`${win} .settings-window__status`).textContent(),
      saved: await savedBgColor(),
    };
    await screenshot('settings-bg-black');
    await closeWindow();
    await page.waitForTimeout(300);
    const canvas = await canvasState(page);
    await screenshot('bg-black', '.canvas-area');

    // Reopening shows the chosen colour.
    await page.locator('.topbar__action-btn').first().click();
    await page.waitForSelector(win);
    await page.locator(`${win} .settings-window__nav-item`, { hasText: '背景色指定' }).click();
    const reopenedSwatch = await selectedSwatch();
    await closeWindow();
    return { fromGear, displayPage, fromShortcut, toast, afterPick, canvas, reopenedSwatch };
  });

  await step('15b-archives-location', async () => {
    // 保存先 (docs/specs/archives.md 「保存先」): another ARCHIVES folder by full path or the folder dialog;
    // nothing is moved, and 既定に戻す shows the default folder's archives again.
    const win = '.settings-window';
    const input = page.locator(`${win} .settings-window__page input.cs-input`);
    const statusLine = () => page.locator(`${win} .settings-window__status`).first().textContent();
    const archiveNames = async () => (await archiveTree(page)).map(r => r.name);
    const before = await archiveNames();

    await page.locator('.topbar__action-btn').first().click();
    await page.waitForSelector(win);
    await page.locator(`${win} .settings-window__nav-item`, { hasText: '保存先' }).click();
    await page.waitForFunction(() => !!document.querySelector('.settings-window__status')?.textContent);
    const opened = {
      nav: await page.locator(`${win} .settings-window__nav-item`).allTextContents(),
      title: await page.locator(`${win} .settings-window__page-title`).textContent(),
      status: await statusLine(),
      input: await input.inputValue(),
      resetDisabled: await page.locator(`${win} button`, { hasText: '既定に戻す' }).isDisabled(),
      applyDisabled: await page.locator(`${win} button`, { hasText: '変更' }).isDisabled(),
    };
    await screenshot('settings-storage');

    // 参照…: the folder dialog runs on the backend PC (tkinter) and is stubbed here.
    const other = path.join(path.dirname(settingsDir), 'other-archives');
    await page.route('**/api/local-files/pick-folder', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: other }) }),
    );
    await page.locator(`${win} button`, { hasText: '参照…' }).click();
    await page.waitForFunction(
      p => (document.querySelector('.settings-window__page input.cs-input') as HTMLInputElement)?.value === p,
      other,
    );
    await page.unroute('**/api/local-files/pick-folder');

    // The folder does not exist: asked before it is created.
    await page.locator(`${win} button`, { hasText: '変更' }).click();
    await page.waitForSelector('.cs-modal-overlay--open');
    const confirmMessage = await page.locator('.cs-modal__message').textContent();
    await page.locator('.cs-modal button', { hasText: '作成して変更' }).click();
    const changedToast = await waitForToast(page, /保存先を/);
    await page.waitForTimeout(500);
    const afterChange = {
      status: await statusLine(),
      created: fs.existsSync(other),
      archives: await archiveNames(),
      saved: (
        JSON.parse(fs.readFileSync(path.join(settingsDir, 'user_settings.json'), 'utf-8')) as Record<string, string>
      ).app_archivesDir,
    };

    // A relative path is refused (folders inside the app too: backend/tests/test_archives_location.py).
    await input.fill('relative-folder');
    await page.locator(`${win} button`, { hasText: '変更' }).click();
    const refused = await waitForToast(page, /変更できませんでした/);

    // Back to the default: its archives are all there again.
    await page.locator(`${win} button`, { hasText: '既定に戻す' }).click();
    await waitForToast(page, /保存先を/);
    await page.waitForTimeout(500);
    const afterReset = { status: await statusLine(), archives: await archiveNames() };
    await page.locator(`${win} .settings-window__close`).click();
    await page.waitForSelector(win, { state: 'detached' });
    await withVisibleToasts(page, () => page.locator('.toast--error .toast__close').last().click());
    await page.waitForFunction(() => !document.querySelector('.toast--error'), undefined, { timeout: 10000 });
    return { before, opened, confirmMessage, changedToast, afterChange, refused, afterReset };
  });

  await step('16-topbar', async () => {
    // The top bar has no menus (File / Edit / View / Help were removed): logo and action icons only.
    return {
      logo: await page.locator('.topbar__logo').textContent(),
      menus: await page.locator('.topbar nav, .topbar__nav-item').count(),
      actions: await page.$$eval('.topbar__action-btn', els => els.map(e => e.getAttribute('title'))),
    };
  });

  await step('17-delete-items-and-undo', async () => {
    await page.mouse.move(800, 500);
    await expandFolder(page, 'e2e-panels');
    await (await childItem(page, 'e2e-panels', 'log.txt')).click();
    await (await childItem(page, 'e2e-panels', 'sub')).click({ modifiers: ['Control'] });
    await page.locator(`${LEFT_PANEL} .layer-panel__action-btn[title="アーカイブ削除"]`).click();
    const deleteToast = await waitForToast(page, /件を削除しました/);
    // The tree refreshes by itself (no refresh button click): the deleted rows disappear.
    await page.waitForFunction(
      panel =>
        !Array.from(document.querySelectorAll(`${panel} .layer-item__name`)).some(e => e.textContent === 'log.txt'),
      LEFT_PANEL,
      { timeout: 5000 },
    );
    const treeAfterDelete = await archiveTree(page);
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
    return { deleteToast, afterDelete, treeAfterDelete, afterUndo: await contents() };
  });

  await step('17b-undo-order', async () => {
    // Each Ctrl+Z restores one deletion, newest first (docs/specs/archives.md 「削除と Undo」).
    // There is no redo; an undo that cannot restore stays the latest entry.
    const archive = path.join(path.dirname(settingsDir), 'archives', 'e2e-undo');
    fs.mkdirSync(path.join(archive, 'a'), { recursive: true });
    for (const name of ['file1.png', 'file2.png', 'a/x.png']) fs.writeFileSync(path.join(archive, name), 'old');
    fs.writeFileSync(path.join(archive, 'keep.txt'), '');
    const present = () => ['file1.png', 'file2.png', 'a'].filter(name => fs.existsSync(path.join(archive, name)));
    const waitFor = async (expected: string[]) => {
      for (let i = 0; i < 50 && present().join() !== expected.join(); i++) await page.waitForTimeout(100);
      return present();
    };
    const deleteChild = async (name: string) => {
      await (await childItem(page, 'e2e-undo', name)).click();
      await page.locator(`${LEFT_PANEL} .layer-panel__action-btn[title="アーカイブ削除"]`).click();
      const toast = await waitForToast(page, new RegExp(`「${name}」を削除しました`));
      await page.waitForFunction(
        ([panel, name]) =>
          !Array.from(document.querySelectorAll(`${panel} .layer-item__name`)).some(e => e.textContent === name),
        [LEFT_PANEL, name],
      );
      return toast;
    };
    const undo = async () => {
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('Control+z');
    };
    // The undo button next to delete: greyed out while there is nothing to undo.
    const undoButton = page.locator(`${LEFT_PANEL} .layer-panel__action-btn[title="削除を元に戻す (Ctrl+Z)"]`);
    const headerButtons = await page.$$eval(`${LEFT_PANEL} .layer-cache__actions button`, els =>
      els.map(e => (e as HTMLButtonElement).title),
    );
    const buttonBeforeDelete = await undoButton.isDisabled();

    await page.locator(`${LEFT_PANEL} .layer-panel__action-btn[title="ARCHIVESを更新"]`).click();
    await page.waitForFunction(
      panel =>
        Array.from(document.querySelectorAll(`${panel} .layer-item__name`)).some(e => e.textContent === 'e2e-undo'),
      LEFT_PANEL,
    );
    await expandFolder(page, 'e2e-undo');
    // The delete button is greyed out while nothing is selected.
    const deleteButton = page.locator(`${LEFT_PANEL} .layer-panel__action-btn[title="アーカイブ削除"]`);
    const deleteWithoutSelection = await deleteButton.isDisabled();
    await (await childItem(page, 'e2e-undo', 'keep.txt')).click();
    const deleteWithSelection = await deleteButton.isDisabled();

    // file1 -> folder a -> file2, then undo twice: file2 comes back, then a; file1 stays deleted.
    const deleteToasts = [await deleteChild('file1.png'), await deleteChild('a'), await deleteChild('file2.png')];
    const afterDeletes = present();
    const buttonAfterDelete = await undoButton.isDisabled();
    await undoButton.click();
    const undoToast = await waitForToast(page, /「file2\.png」を元に戻しました/);
    const afterUndo1 = await waitFor(['file2.png']);
    await undo();
    const afterUndo2 = await waitFor(['file2.png', 'a']);

    // Something new with the same name: the undo is refused and stays on the stack until it is moved away.
    fs.writeFileSync(path.join(archive, 'file1.png'), 'new');
    await undo();
    const conflictToast = await waitForToast(page, /元に戻せませんでした/);
    await page.waitForTimeout(300);
    const conflict = { newKept: fs.readFileSync(path.join(archive, 'file1.png'), 'utf-8') };
    fs.unlinkSync(path.join(archive, 'file1.png'));
    await undo();
    await waitFor(['file1.png', 'file2.png', 'a']);
    const retried = fs.readFileSync(path.join(archive, 'file1.png'), 'utf-8');
    await undo();
    const emptyToast = await waitForToast(page, /元に戻す削除はありません/);
    const buttonWhenEmpty = await undoButton.isDisabled();

    // Pressed twice in a row: both deletions come back.
    await page.locator(`${LEFT_PANEL} .layer-panel__action-btn[title="ARCHIVESを更新"]`).click();
    await page.waitForTimeout(300);
    await deleteChild('file1.png');
    await deleteChild('file2.png');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    const afterDoubleUndo = await waitFor(['file1.png', 'file2.png', 'a']);

    // Ignored while the settings window is open.
    await page.waitForTimeout(300);
    await deleteChild('file1.png');
    await page.locator('.topbar__action-btn').first().click();
    await page.waitForSelector('.settings-window');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(800);
    const whileWindowOpen = present();
    await page.keyboard.press('Escape');
    await page.waitForSelector('.settings-window', { state: 'detached' });
    await undo();
    const afterClose = await waitFor(['file1.png', 'file2.png', 'a']);
    await page.locator(`${LEFT_PANEL} .layer-panel__action-btn[title="ARCHIVESを更新"]`).click();
    await page.waitForTimeout(300);

    return {
      headerButtons,
      buttonBeforeDelete,
      deleteWithoutSelection,
      deleteWithSelection,
      buttonAfterDelete,
      buttonWhenEmpty,
      deleteToasts,
      afterDeletes,
      undoToast,
      afterUndo1,
      afterUndo2,
      conflictToast,
      conflict,
      retried,
      emptyToast,
      afterDoubleUndo,
      whileWindowOpen,
      afterClose,
    };
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
    await openNanoBananaWithoutOriginal(page);

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
    // The run closed the window; reopen it to switch back.
    await clickTool(page, 'Nano Banana画像生成');
    await page.waitForSelector(sidebar);
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
    await openNanoBananaWithoutOriginal(page);
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

    await openNanoBananaWithoutOriginal(page);
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

    // The request: the automatic aspect ratio, and the 原画 as 画像1 (before the reference images) with its heading.
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
      const body = images[0]; // the 原画 (always 画像1) comes back as the generated image
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

    // The image on the canvas (the result, selected after saving) is the 原画 when the window opens;
    // × removes it and 「表示中の画像を原画にする」 sets it again.
    await clickTool(page, 'Nano Banana画像生成');
    await page.waitForSelector(win);
    const autoSet = JSON.parse(maskTimestamps(JSON.stringify(await originalState())));
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
      autoSet,
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

  await step('19f-original-on-open', async () => {
    // Opening the tool puts the image on the canvas into the 原画 (docs/specs/tools/nano-banana-pro.md 「原画」).
    const win = '.tool-window';
    const original = async () => {
      const card = page.locator(`${win} .nbp-original__card`);
      if (!(await card.count())) return null;
      return maskTimestamps(await card.locator('.ref-card__main').innerText());
    };
    const openAndRead = async () => {
      await clickTool(page, 'Nano Banana画像生成');
      await page.waitForSelector(win);
      const value = await original();
      await closeToolWindow(page);
      return value;
    };

    // Selecting another image replaces the 原画 when the window opens.
    await archiveItem(page, 'e2e-image.png').click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLCanvasElement>('.canvas-area canvas')).some(c => c.width === 640),
    );
    await clickTool(page, 'Nano Banana画像生成');
    await page.waitForSelector(win);
    const selected = await original();
    await screenshot('nbp-original-on-open', `${win} .tool-window__column:nth-child(2)`);

    // × removes it; the next open fills it again.
    await page.locator(`${win} .nbp-original__card .ref-card__remove`).click();
    await closeToolWindow(page);
    const afterRemove = await openAndRead();

    // Nothing selected: the previous 原画 stays.
    await archiveItem(page, 'e2e-image.png').click(); // second click deselects
    await page.waitForFunction(() => !document.querySelector('.layer-item--selected'));
    const nothingSelected = await openAndRead();

    // Other view modes leave the 原画 as it is (here: removed, so the window opens without one).
    await archiveItem(page, 'e2e-image.png').click();
    await openNanoBananaWithoutOriginal(page);
    await closeToolWindow(page);
    // (Parallel mode shows a second ARCHIVES panel instead of the tools, Overlay mode hides them.)
    await setMode(page, 'Batch');
    const batchMode = await openAndRead();
    await setMode(page, 'Normal');

    // Reference images filling the model's limit (14): adding the 原画 would drop one, so it is not added.
    await openNanoBananaWithoutOriginal(page);
    await page.evaluate(async () => {
      const dt = new DataTransfer();
      for (let i = 0; i < 14; i++) {
        const c = document.createElement('canvas');
        c.width = 32;
        c.height = 32;
        const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'));
        dt.items.add(new File([blob], `full${i}.png`, { type: 'image/png' }));
      }
      const input = document.querySelector<HTMLInputElement>('.tool-window .ref-section input[type=file]')!;
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    });
    await page.locator(`${win} .ref-card`).nth(13).waitFor();
    await closeToolWindow(page);
    await clickTool(page, 'Nano Banana画像生成');
    await page.waitForSelector(win);
    const referencesFull = {
      original: await original(),
      references: await page.locator(`${win} .ref-list .ref-card`).count(),
    };
    // Clean up: remove the reference images.
    while ((await page.locator(`${win} .ref-list .ref-card`).count()) > 0) {
      await page.locator(`${win} .ref-list .ref-card .ref-card__remove`).first().click();
    }
    await closeToolWindow(page);
    return { selected, afterRemove, nothingSelected, batchMode, referencesFull };
  });

  await step('19g-image-loader', async () => {
    // 画像読み込み has a window with the folder the dialog starts in (docs/specs/tools/image-loader.md).
    // The dialog itself is the backend's and is stubbed here.
    const win = '.tool-window';
    const folderInput = page.locator(`${win} input.cs-input`);
    const missing = path.join(settingsDir, 'missing-folder');
    const requests: { initial_dir: string }[] = [];
    await clickTool(page, '画像読み込み');
    await page.waitForSelector(win);
    const windowState = await toolWindowState(page);
    await screenshot('window-画像読み込み', win);

    // A folder that does not exist only warns; the window stays open and the dialog does not open.
    await folderInput.fill(missing);
    await page.locator(`${win} .tool-window__run`).click();
    const missingToast = (await waitForToast(page, /画像読み込み: フォルダが見つかりません/)).replace(
      missing,
      '<MISSING>',
    );
    const openAfterMissing = (await page.locator(win).count()) === 1;

    // An existing folder (quoted as by "Copy as path"): the window closes and the chosen image is imported.
    await stubFileDialog(page, { name: 'ダイアログ画像.png', body: await makePng(page, 120, 90) }, requests);
    await folderInput.fill(`"${settingsDir}"`);
    await page.locator(`${win} .tool-window__run`).click();
    const toast = maskTimestamps(await waitForToast(page, /ダイアログ画像\.png を読み込みました/));
    await page.locator(win).waitFor({ state: 'detached' });
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLCanvasElement>('.canvas-area canvas')).some(c => c.width === 120),
    );
    const savedFolder = (
      JSON.parse(fs.readFileSync(path.join(settingsDir, 'user_settings.json'), 'utf-8')) as Record<string, string>
    ).imageLoader_initialDir;

    // ▶ runs it without the window, with the saved folder; cancelling the dialog shows nothing.
    await stubFileDialog(page, null, requests);
    const toastsBefore = (await toastStack(page)).length;
    const requestsBefore = requests.length;
    await playButton(page, '画像読み込み').click();
    for (let i = 0; i < 50 && requests.length === requestsBefore; i++) await page.waitForTimeout(100);
    await page.waitForFunction(() => !document.querySelector('.ai-panel__list--busy'));
    const play = {
      windowOpened: (await page.locator(win).count()) > 0,
      newToasts: (await toastStack(page)).length - toastsBefore,
    };
    await page.unroute('**/api/local-files/pick-image');
    return {
      window: windowState,
      missingToast,
      openAfterMissing,
      toast,
      savedFolderIsSet: savedFolder === `"${settingsDir}"`,
      dialogStartedIn: requests.map(r => (r.initial_dir === `"${settingsDir}"` ? '<SETTINGS_DIR>' : r.initial_dir)),
      play,
      archives: await archiveTree(page),
    };
  });

  await step('19h-play-and-stop', async () => {
    // ▶ runs a tool without its window; while it runs the button is ⏸ and stops the run
    // (docs/specs/ai-panel.md 「実行の停止」). コマ結合 is saved by the backend, so stopping removes the result.
    const mergeFolders = () =>
      page.evaluate(async apiBase => {
        const entries = (await (await fetch(`${apiBase}/archives/e2e-panels/contents`)).json()) as { key: string }[];
        return new Set(entries.map(e => /^(e2e-panels\/[^/]*_コマ結合)\//.exec(e.key)?.[1]).filter(Boolean)).size;
      }, apiBase);
    if (!(await archiveItem(page, /^sub$/).count())) await expandFolder(page, 'e2e-panels');
    await archiveItem(page, /^sub$/).click();
    await page.waitForFunction(() => !!document.querySelector('.layer-item--selected'));
    const before = await mergeFolders();
    await screenshot('tool-list-play', '.ai-panel');

    let release = () => {};
    const held = new Promise<void>(resolve => (release = resolve));
    await page.route('**/api/image/merge-panels', async route => {
      await held;
      await route.continue();
    });
    await playButton(page, 'コマ結合').click();
    await page.waitForSelector('.ai-tool-row--running');
    const running = {
      windowOpened: (await page.locator('.tool-window').count()) > 0,
      icon: await playButton(page, 'コマ結合').innerText(),
      title: await playButton(page, 'コマ結合').getAttribute('title'),
      otherIcon: await playButton(page, '背景除去').innerText(),
    };
    await screenshot('tool-list-running', '.ai-panel');

    await playButton(page, 'コマ結合').click();
    const stopToast = await waitForToast(page, /コマ結合: 実行を停止しました/);
    const afterStop = {
      busy: (await page.locator('.ai-panel__list--busy').count()) > 0,
      status: await page.locator('.statusbar__left').innerText(),
      icon: await playButton(page, 'コマ結合').innerText(),
    };
    const successToasts = () =>
      toastStack(page).then(ts => ts.filter(t => t.message?.includes('結合画像を保存')).length);
    const successBefore = await successToasts();
    // The backend still saves the image when the request goes on; the stopped run then moves it to the trash.
    const responded = page.waitForResponse(res => res.url().includes('/api/image/merge-panels'));
    release();
    await responded;
    await page.unroute('**/api/image/merge-panels');
    await page.waitForFunction(
      async ({ apiBase, before }) => {
        const entries = (await (await fetch(`${apiBase}/archives/e2e-panels/contents`)).json()) as { key: string }[];
        return (
          new Set(entries.map(e => /^(e2e-panels\/[^/]*_コマ結合)\//.exec(e.key)?.[1]).filter(Boolean)).size === before
        );
      },
      { apiBase, before },
      { polling: 200, timeout: 10000 },
    );
    const after = await mergeFolders();

    // ▶ Nano Banana画像生成 runs without its window too (E2E has no API key, so it fails).
    await playButton(page, 'Nano Banana画像生成').click();
    await waitForToast(page, /Nano Banana画像生成の実行に失敗しました/);
    const nanoWindowOpened = (await page.locator('.tool-window').count()) > 0;
    await withVisibleToasts(page, async () => {
      while ((await page.locator('.toast--error').count()) > 0) {
        const count = await page.locator('.toast--error').count();
        await page.locator('.toast--error .toast__close').first().click();
        await page.waitForFunction(n => document.querySelectorAll('.toast--error').length < n, count);
      }
    });
    return {
      before,
      running,
      stopToast,
      afterStop,
      after,
      successToastsAfterStop: (await successToasts()) - successBefore,
      nanoWindowOpened,
    };
  });

  await step('19i-cost-monitor', async () => {
    // docs/specs/cost-monitor.md. The tools above are stubbed in the browser, so nothing was recorded yet.
    const costButton = page.locator('.left-toolbar__btn[title="Cost Monitor"]');
    await costButton.click();
    await page.waitForSelector('.cost-monitor__tile');
    await page.waitForTimeout(300);
    const emptyShown = await page.locator('.cost-monitor__empty').isVisible();
    await screenshot('cost-monitor-empty');

    // Records relative to the browser's fixed clock (2026-01-01 10:00, see main()): 3 days ago is last month.
    // Stored with the backend's own usage_store.insert into the temporary data/usage.db (seedUsage in main()).
    const now = new Date('2026-01-01T10:00:00');
    const daysAgo = (days: number, hour: number) =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hour, 0).toISOString();
    const usage = (input: number, image: number, thought: number, images: number) => ({
      input_tokens: input,
      cached_tokens: 0,
      output_text_tokens: 0,
      output_image_tokens: image,
      thought_tokens: thought,
      search_queries: 0,
      images,
    });
    const rec = (id: string, at: string, tool: string, model: string, cost: number | null, extra = {}) => ({
      id,
      at,
      user: 'local',
      tool,
      model,
      api: 'generate_content',
      service_tier: 'standard',
      status: 'success',
      usage: tool === 'コマ分割' ? usage(1200, 0, 300, 0) : usage(500, 1120, 200, 1),
      cost_usd: cost,
      estimated: false,
      prices_checked_on: '2026-10-04',
      ...extra,
    });
    seedUsage([
      rec('a', daysAgo(3, 10), 'Nano Banana画像生成', 'gemini-3.1-flash-image', 0.0672, { service_tier: 'flex' }),
      rec('b', daysAgo(1, 11), 'Nano Banana画像生成', 'gemini-9-unknown', null),
      rec('c', daysAgo(0, 0), 'コマ分割', 'gemini-3.8-flash', 0.002),
      rec('d', daysAgo(0, 0), 'Nano Banana画像生成', 'gemini-3-pro-image', 0.24, { estimated: true }),
      rec('e', daysAgo(0, 0), 'Nano Banana画像生成', 'gemini-3-pro-image', 0.0024, { status: 'no_output' }),
    ]);

    await page.locator('.cost-monitor__header .cs-icon-btn[title="再読み込み"]').click();
    await page.waitForSelector('.cost-bars__row');
    await page.waitForTimeout(300);
    const texts = (selector: string) => page.$$eval(selector, els => els.map(e => (e as HTMLElement).innerText));
    const rows = (selector: string) =>
      page.$$eval(selector, trs => trs.map(r => Array.from(r.children).map(td => (td as HTMLElement).innerText)));
    const read = async () => ({
      range: await page.locator('.cost-range__btn--active').textContent(),
      rangeDates: await page.locator('.cost-range > .cost-monitor__muted').textContent(),
      tiles: await texts('.cost-monitor__tile'),
      toolBars: await texts('.cost-monitor__pair .cost-bars__row'),
      overall: await page.locator('.cost-bars__overall').innerText(),
      models: await rows('.cost-monitor__pair .cost-monitor__table tbody tr'),
      columns: await page.locator('.cost-chart__hit').count(),
      selectedColumn: await page.$$eval('.cost-chart__hit', els =>
        els.findIndex(e => e.getAttribute('aria-pressed') === 'true'),
      ),
    });
    const before = await read();
    const chart = {
      title: await page.locator('.cost-monitor__details .cost-monitor__card-title').first().textContent(),
      legend: await page.$$eval('.cost-chart__legend-item', els => els.map(e => e.textContent)),
      segments: await page.$$eval('.cost-chart__svg [class^="cost-chart__s"]', els =>
        els.map(e => e.getAttribute('class')),
      ),
      yLabels: await page.$$eval('.cost-chart__svg text[text-anchor="end"]', els => els.map(e => e.textContent)),
    };
    await page.locator('.cost-chart__hit').last().hover();
    await page.waitForTimeout(200);
    const tooltip = await page.locator('.cost-chart__tooltip--shown').innerText();
    await screenshot('cost-monitor');
    const readDay = async () => ({
      head: await page.locator('.cost-day__head').innerText(),
      tools: await texts('.cost-day .cost-bars__row'),
      models: await rows('.cost-day .cost-day__grid .cost-monitor__table tbody tr'),
      runs: await rows('.cost-day > .cost-monitor__table-wrap tbody tr'),
      empty: await page.locator('.cost-day > p').count(),
    });
    const today = await readDay();

    // Clicking a bar shows that day (3 days ago = 12/29) and marks its column.
    const columns = page.locator('.cost-chart__hit');
    await columns.nth(before.columns - 1 - 3).click();
    await page.waitForFunction(() => document.querySelector('.cost-day__head')?.textContent?.includes('12/29'));
    await page.waitForTimeout(500);
    const clickedDay = await readDay();
    const clickedColumn = await page.$$eval('.cost-chart__hit', els =>
      els.findIndex(e => e.getAttribute('aria-pressed') === 'true'),
    );
    await screenshot('cost-monitor-day', '.cost-day');
    // A day without use says so.
    await columns.nth(before.columns - 1 - 2).click();
    await page.waitForFunction(() => document.querySelector('.cost-day__head')?.textContent?.includes('12/30'));
    const unusedDay = await readDay();

    const historyRows = await rows('.cost-monitor__details > .cost-monitor__card:last-child tbody tr');
    const google = await page.locator('.cost-monitor__section').nth(1).innerText();
    const toasts = await toastStack(page);

    // The period scopes the chart, the tool totals and the average; it is saved right away.
    const pickRange = async (label: string) => {
      await page.locator('.cost-range__btn', { hasText: label }).click();
      await page.waitForFunction(
        l =>
          document.querySelector('.cost-range__btn--active')?.textContent === l &&
          !document.querySelector('.cost-monitor--loading'),
        label,
      );
      await page.waitForTimeout(200);
      return read();
    };
    const week = await pickRange('7日');
    const month = await pickRange('今月');
    const savedRange = await page.evaluate(
      async apiBase =>
        ((await (await fetch(`${apiBase}/settings/tools`)).json()) as { values: Record<string, string> }).values
          .costMonitor_range,
      apiBase,
    );
    await pickRange('30日');

    // The exchange rate is saved right away and converts every amount.
    await page.locator('.cost-monitor__rate-input').fill('100');
    await page.locator('.cost-monitor__rate-input').press('Enter');
    await page.waitForTimeout(300);
    const afterRate = await texts('.cost-monitor__tile .cost-amount');
    const savedRate = await page.evaluate(
      async apiBase =>
        ((await (await fetch(`${apiBase}/settings/tools`)).json()) as { values: Record<string, string> }).values
          .costMonitor_usdJpyRate,
      apiBase,
    );

    // Clicking the active button returns to Normal mode.
    await costButton.click();
    await page.waitForTimeout(300);
    const activeAfterLeave = await page.$$eval('.left-toolbar__btn--active', els =>
      els.map(e => e.getAttribute('title')),
    );
    const shownAfterLeave = await page.locator('.cost-monitor').isVisible();
    await page.waitForFunction(() => !document.querySelector('.toast--warning'), undefined, { timeout: 10000 });
    return {
      emptyShown,
      before,
      chart,
      tooltip,
      today,
      clickedDay,
      clickedColumn,
      unusedDay,
      historyRows,
      google,
      toasts,
      week,
      month,
      savedRange,
      afterRate,
      savedRate,
      activeAfterLeave,
      shownAfterLeave,
    };
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
        CONFEITO_ASSETS_DIR: path.join(dataDir, 'assets'),
        CONFEITO_DATA_DIR: path.join(dataDir, 'data'),
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
    // The backend's file dialog must never open on the desktop: scenarios answer it with stubFileDialog,
    // anything else gets an error.
    await page.route(/\/api\/local-files\/pick-image$/, route =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify({ detail: 'E2E: the file dialog is not stubbed' }),
      }),
    );
    // Face detection would download its model into the real models/ folder: scenarios stub it, anything else fails.
    await page.route(/\/api\/characters\/detect-faces$/, route =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify({ detail: 'E2E: face detection is not stubbed' }),
      }),
    );
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
    /** Stores Cost Monitor records with the backend's code (services/usage_store.py) in the temporary data dir. */
    const seedUsage = (records: object[]) => {
      const script = [
        'import json, sys',
        'from src.app.services import usage_store',
        'for r in json.load(sys.stdin): usage_store.insert(r)',
      ].join('\n');
      const result = spawnSync(opts.python, ['-c', script], {
        cwd: path.join(opts.root, 'backend'),
        input: JSON.stringify(records),
        encoding: 'utf-8',
        env: {
          ...process.env,
          CONFEITO_DATA_DIR: path.join(dataDir, 'data'),
          CONFEITO_ENV_FILE: path.join(dataDir, '.env'),
          PYTHONUTF8: '1',
        },
      });
      if (result.status !== 0) throw new Error(`seedUsage failed: ${result.stderr}`);
    };
    await runScenarios(page, apiBase, settingsDir, opts.out, obs, seedUsage);
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
