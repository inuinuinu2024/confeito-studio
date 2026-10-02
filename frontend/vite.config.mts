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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [closeOnDisconnectPlugin(env.VITE_API_BASE || DEFAULT_API_BASE)],
    server: {
      port: 45173,
      strictPort: true,
    },
  };
});
