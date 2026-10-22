// Dev-server API (mounted by the Vite plugin in vite.config.ts).
//
//   POST /api/generate     multipart: image (file), subject? (text), model? (trellis-2 | hunyuan-3.1)
//                          -> application/x-ndjson stream of
//                             {"type":"log","message":string}
//                             {"type":"done","generation":Generation}
//                             {"type":"error","message":string}
//   GET  /api/generations  -> Generation[] (newest first)
//   GET  /api/files/<id>/<photo.jpg|cutout.png|model.glb>
//
// Every generation is saved under samples/generated/<id>/ so it can be reloaded for free.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '../../..');
const STORE = join(ROOT, 'samples/generated');
const generateModule = pathToFileURL(join(ROOT, 'tools/generate/generate.ts')).href;

export interface Generation {
  id: string;
  createdAt: string;
  subject: string;
  model: string;
  segmenter: string;
  seconds: number;
  photoUrl: string;
  cutoutUrl: string;
  glbUrl: string;
}

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
};

function urls(id: string, photoName: string) {
  return {
    photoUrl: `/api/files/${id}/${photoName}`,
    cutoutUrl: `/api/files/${id}/cutout.png`,
    glbUrl: `/api/files/${id}/model.glb`,
  };
}

function text(res: ServerResponse, status: number, message: string) {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain');
  res.end(message);
}

export async function handle(req: IncomingMessage, res: ServerResponse, log: (m: string) => void): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/api/generations' && req.method === 'GET') {
    const ids = await readdir(STORE).catch(() => [] as string[]);
    const all: Generation[] = [];
    for (const id of ids) {
      const meta = await readFile(join(STORE, id, 'meta.json'), 'utf8').catch(() => null);
      if (meta) all.push(JSON.parse(meta));
    }
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(all));
    return true;
  }

  const file = url.pathname.match(/^\/api\/files\/([\w-]+)\/([\w.-]+)$/);
  if (file && req.method === 'GET') {
    const bytes = await readFile(join(STORE, file[1], file[2])).catch(() => null);
    if (!bytes) return text(res, 404, 'not found'), true;
    res.setHeader('content-type', CONTENT_TYPES[extname(file[2])] ?? 'application/octet-stream');
    res.setHeader('cache-control', 'max-age=31536000, immutable');
    res.end(bytes);
    return true;
  }

  if (url.pathname === '/api/generate') {
    if (req.method !== 'POST') return text(res, 405, 'POST only'), true;
    const form = await new Request('http://localhost/api/generate', {
      method: 'POST',
      headers: req.headers as Record<string, string>,
      body: Readable.toWeb(req) as ReadableStream,
      duplex: 'half',
    } as RequestInit).formData();
    const image = form.get('image');
    if (!(image instanceof Blob)) return text(res, 400, 'missing "image" field'), true;
    const subject = String(form.get('subject') ?? '').trim();
    const model = String(form.get('model') ?? 'trellis-2');

    res.setHeader('content-type', 'application/x-ndjson');
    res.setHeader('cache-control', 'no-cache');
    const send = (msg: object) => res.write(JSON.stringify(msg) + '\n');
    try {
      const { generateGlb, MODELS } = await import(/* @vite-ignore */ generateModule);
      if (!(model in MODELS)) throw new Error(`unknown model ${model}`);
      const onLog = (message: string) => {
        log(message);
        send({ type: 'log', message });
      };
      const r = await generateGlb(image, { subject, model, onLog });

      const createdAt = new Date().toISOString();
      const id = createdAt.replace(/[:.]/g, '-').replace('Z', '') + '-' + Math.random().toString(36).slice(2, 6);
      const ext = { 'image/png': '.png', 'image/webp': '.webp' }[image.type] ?? '.jpg';
      const photoName = `photo${ext}`;
      const dir = join(STORE, id);
      await mkdir(dir, { recursive: true });
      await Promise.all([
        writeFile(join(dir, photoName), Buffer.from(await image.arrayBuffer())),
        writeFile(join(dir, 'cutout.png'), Buffer.from(r.cutout)),
        writeFile(join(dir, 'model.glb'), Buffer.from(r.glb)),
      ]);
      const generation: Generation = {
        id,
        createdAt,
        subject,
        model: r.model,
        segmenter: r.segmenter,
        seconds: r.seconds,
        ...urls(id, photoName),
      };
      await writeFile(join(dir, 'meta.json'), JSON.stringify(generation, null, 2));
      log(`done in ${r.seconds.toFixed(0)} s -> ${dir}`);
      send({ type: 'done', generation });
    } catch (e) {
      send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
    res.end();
    return true;
  }
  return false;
}
