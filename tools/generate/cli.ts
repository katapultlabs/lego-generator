// Usage: pnpm --dir tools/generate generate <photo...> [--subject bird] [--model trellis-2|hunyuan-3.1]
//        [--resolution 512|1024|1536] [--out DIR]
// Writes <out>/<photo-name>.<model>.glb and <photo-name>.cutout.png. Each call costs ~$0.30–0.40 on fal.ai.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { falKey, generateGlb, MODELS, type GenerateOptions, type ModelId } from './generate.ts';

const args = process.argv.slice(2);
let out = resolve(import.meta.dirname, '../../samples/generated');
const opts: GenerateOptions = {};
const photos: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = resolve(args[++i]);
  else if (args[i] === '--resolution') opts.resolution = args[++i] as GenerateOptions['resolution'];
  else if (args[i] === '--subject') opts.subject = args[++i];
  else if (args[i] === '--model') opts.model = args[++i] as ModelId;
  else photos.push(resolve(args[i]));
}
if (!photos.length || (opts.model && !(opts.model in MODELS))) {
  console.error(`usage: generate <photo...> [--subject TEXT] [--model ${Object.keys(MODELS).join('|')}] [--resolution 512|1024|1536] [--out DIR]`);
  process.exit(1);
}
if (!falKey()) {
  console.error('No fal.ai key: set FAL_KEY or add the Keychain item (see README).');
  process.exit(1);
}

const types: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
await mkdir(out, { recursive: true });
for (const photo of photos) {
  const name = basename(photo, extname(photo));
  const blob = new Blob([await readFile(photo)], { type: types[extname(photo).toLowerCase()] ?? 'application/octet-stream' });
  const r = await generateGlb(blob, { ...opts, onLog: (m) => console.log(`[${name}] ${m}`) });
  const file = join(out, `${name}.${r.model}.glb`);
  await writeFile(file, Buffer.from(r.glb));
  await writeFile(join(out, `${name}.cutout.png`), Buffer.from(r.cutout));
  console.log(`[${name}] ${(r.glb.byteLength / 1e6).toFixed(1)} MB in ${r.seconds.toFixed(0)} s via ${r.segmenter} + ${r.model} -> ${file}`);
}
