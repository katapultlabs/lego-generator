// Brick engine facade over the Rust/WASM engine running in a Web Worker.
// Build the WASM with `pnpm wasm` (writes src/wasm/).

import type { BrickModel, BrickifyOptions } from './types';

export type { BrickifyOptions } from './types';

const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let nextId = 1;

worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  if (e.data.ok) p.resolve(e.data.result);
  else p.reject(new Error(e.data.error));
};

function call<T>(type: string, payload: unknown, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload }, transfer);
  });
}

/** Parse a GLB once. Subsequent brickify() calls reuse the parsed mesh. */
export async function loadMesh(glb: ArrayBuffer): Promise<void> {
  // Copy: the caller keeps using its buffer for the source-mesh view.
  const copy = glb.slice(0);
  await call<number>('load', copy, [copy]);
}

// The worker runs one job at a time; while one runs, only the newest request waits behind it.
let latest = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Re-run cheaply when options change. Rejects with Error('superseded') if a newer call replaced it. */
export async function brickify(opts: BrickifyOptions): Promise<BrickModel> {
  const mine = ++latest;
  const run = queue.then(() => {
    if (mine !== latest) throw new Error('superseded');
    return call<BrickModel>('brickify', opts);
  });
  queue = run.catch(() => {});
  return run;
}

/** Serialize a model to LDraw (.ldr) text. */
export async function toLdraw(model: BrickModel): Promise<string> {
  return call<string>('ldraw', { model, name: 'model' });
}

/** Serialize a model to a BrickLink wanted list (.xml). */
export async function toBricklinkXml(model: BrickModel): Promise<string> {
  return call<string>('bricklink', { model });
}
