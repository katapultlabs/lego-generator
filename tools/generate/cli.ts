// Usage: pnpm --dir tools/generate generate <photo...> [--out DIR] [--resolution 512|1024|1536]
// Writes <out>/<photo-name>.glb for each photo. Each call costs ~$0.25–0.35 on fal.ai.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { generateGlb, type GenerateOptions } from './generate.ts';

const args = process.argv.slice(2);
let out = resolve(import.meta.dirname, '../../samples/generated');
let resolution: GenerateOptions['resolution'];
const photos: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = resolve(args[++i]);
  else if (args[i] === '--resolution') resolution = args[++i] as GenerateOptions['resolution'];
  else photos.push(resolve(args[i]));
}
if (!photos.length) {
  console.error('usage: generate <photo...> [--out DIR] [--resolution 512|1024|1536]');
  process.exit(1);
}
if (!process.env.FAL_KEY) {
  console.error('FAL_KEY is not set; run through `op run --env-file=.env -- ...`');
  process.exit(1);
}

const types: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
await mkdir(out, { recursive: true });
for (const photo of photos) {
  const name = basename(photo, extname(photo));
  const blob = new Blob([await readFile(photo)], { type: types[extname(photo).toLowerCase()] ?? 'application/octet-stream' });
  const r = await generateGlb(blob, { resolution, onLog: (m) => console.log(`[${name}] ${m}`) });
  const file = join(out, `${name}.glb`);
  await writeFile(file, Buffer.from(r.glb));
  console.log(`[${name}] ${(r.glb.byteLength / 1e6).toFixed(1)} MB in ${r.seconds.toFixed(0)} s -> ${file} (request ${r.requestId})`);
}
