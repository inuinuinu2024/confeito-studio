import { defineConfig, loadEnv, type Plugin } from 'vite';

const DEFAULT_API_BASE = 'http://127.0.0.1:48000/api'; // keep in sync with src/shared/config.ts
const SHUTDOWN_GRACE_MS = 4000;

/**
 * Stops the dev server — and the backend via POST /api/shutdown — once every browser tab
 * has been closed. Reloads are tolerated: shutdown waits SHUTDOWN_GRACE_MS and only arms
 * after the first connection.
 */
function closeOnDisconnectPlugin(apiBase: string): Plugin {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let connections = 0;
  let hasConnectedOnce = false;

  return {
    name: 'close-on-disconnect',
    configureServer(server) {
      server.ws.on('connection', socket => {
        hasConnectedOnce = true;
        connections++;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        socket.on('close', () => {
          connections--;
          if (!hasConnectedOnce || connections > 0) return;
          timer = setTimeout(async () => {
            console.log('\nAll browser tabs closed. Shutting down servers...');
            try {
              await fetch(`${apiBase}/shutdown`, { method: 'POST' });
            } catch {
              // backend already stopped
            }
            process.exit(0);
          }, SHUTDOWN_GRACE_MS);
        });
      });
    },
  };
}

/**
 * Makes every dev-server response `Cache-Control: no-store` so the browser keeps nothing on disk
 * (docs/specs/app-shell.md 「ブラウザに残すもの」). Vite sets its own Cache-Control on some files
 * (e.g. `max-age=31536000,immutable` for pre-bundled deps), so both ways of setting headers are wrapped.
 */
function noStorePlugin(): Plugin {
  const isCacheControl = (name: string) => name.toLowerCase() === 'cache-control';
  return {
    name: 'no-store',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        const setHeader = res.setHeader.bind(res);
        res.setHeader = (name, value) => setHeader(name, isCacheControl(name) ? 'no-store' : value);
        const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => typeof res;
        res.writeHead = ((...args: unknown[]) => {
          const headers = args.find(a => a && typeof a === 'object' && !Array.isArray(a)) as
            Record<string, unknown> | undefined;
          for (const key of Object.keys(headers ?? {})) if (isCacheControl(key)) headers![key] = 'no-store';
          return writeHead(...args);
        }) as typeof res.writeHead;
        res.setHeader('Cache-Control', 'no-store');
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [noStorePlugin(), closeOnDisconnectPlugin(env.VITE_API_BASE || DEFAULT_API_BASE)],
    server: {
      port: 45173,
      strictPort: true,
    },
  };
});
