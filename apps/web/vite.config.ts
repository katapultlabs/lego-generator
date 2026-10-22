import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { handle } from './server/api';

// Dev-server API: photo -> 3D generation via fal.ai and the saved-generations store (server/api.ts).
// FAL_KEY comes from 1Password: `pnpm dev` runs vite under `op run`.
function api(): Plugin {
  return {
    name: 'brickify-api',
    configureServer(server) {
      const log = (m: string) => server.config.logger.info(`[fal] ${m}`, { timestamp: true });
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        try {
          if (!(await handle(req, res, log))) next();
        } catch (e) {
          res.statusCode = 500;
          res.end(e instanceof Error ? e.message : String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), api()],
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
