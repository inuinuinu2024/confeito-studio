import { defineConfig, Plugin } from 'vite';

function closeOnDisconnectPlugin(): Plugin {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let activeConnections = 0;
  let hasConnectedOnce = false;

  return {
    name: 'close-on-disconnect',
    configureServer(server) {
      server.ws.on('connection', (client) => {
        hasConnectedOnce = true;
        activeConnections++;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        
        client.on('close', () => {
          activeConnections--;
          if (hasConnectedOnce && activeConnections <= 0) {
            timeoutId = setTimeout(async () => {
              console.log('\nAll browser tabs closed. Shutting down servers...');
              try {
                await fetch('http://localhost:48000/api/shutdown', { method: 'POST' });
              } catch (e) {
                // Ignore errors if backend is already down
              }
              // @ts-ignore
              process.exit(0);
            }, 4000);
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [closeOnDisconnectPlugin()],
  server: {
    port: 45173,
    strictPort: true,
  },
});
