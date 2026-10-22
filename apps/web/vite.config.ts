import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const generateModule = pathToFileURL(resolve(import.meta.dirname, '../../tools/generate/generate.ts')).href;

// POST /api/generate (multipart, field "image") -> GLB bytes, via TRELLIS.2 on fal.ai.
// FAL_KEY comes from 1Password: `pnpm dev` runs vite under `op run`.
function falGenerate(): Plugin {
  return {
    name: 'fal-generate',
    configureServer(server) {
      server.middlewares.use('/api/generate', async (req, res) => {
        const fail = (status: number, message: string) => {
          res.statusCode = status;
          res.setHeader('content-type', 'text/plain');
          res.end(message);
        };
        if (req.method !== 'POST') return fail(405, 'POST only');
        if (!process.env.FAL_KEY) return fail(503, 'FAL_KEY is not set; start the dev server with `pnpm dev`.');
        try {
          const request = new Request(`http://localhost${req.url}`, {
            method: 'POST',
            headers: req.headers as Record<string, string>,
            body: Readable.toWeb(req) as ReadableStream,
            duplex: 'half',
          } as RequestInit);
          const image = (await request.formData()).get('image');
          if (!(image instanceof Blob)) return fail(400, 'missing "image" field');
          const { generateGlb } = await import(/* @vite-ignore */ generateModule);
          const log = (m: string) => server.config.logger.info(`[fal] ${m}`, { timestamp: true });
          const r = await generateGlb(image, { onLog: log });
          log(`done in ${r.seconds.toFixed(0)} s (${(r.glb.byteLength / 1e6).toFixed(1)} MB)`);
          res.setHeader('content-type', 'model/gltf-binary');
          res.end(Buffer.from(r.glb));
        } catch (e) {
          fail(502, `Generation failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), falGenerate()],
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
