// Runs the Rust brick engine (WASM) off the main thread.
// Messages: { id, type: 'load' | 'brickify' | 'ldraw', payload } -> { id, ok, result | error }.

import init, { Engine, toLdraw } from './wasm/brick_wasm.js';

const ready = init();
let engine: Engine | null = null;

self.onmessage = async (e: MessageEvent<{ id: number; type: string; payload: any }>) => {
  const { id, type, payload } = e.data;
  try {
    await ready;
    let result: unknown;
    if (type === 'load') {
      engine?.free();
      engine = null;
      engine = new Engine(new Uint8Array(payload as ArrayBuffer));
      result = engine.triangleCount();
    } else if (type === 'brickify') {
      if (!engine) throw new Error('No mesh loaded');
      const t0 = performance.now();
      const model = JSON.parse(engine.brickify(JSON.stringify(payload)));
      model.stats.millis = performance.now() - t0;
      result = model;
    } else if (type === 'ldraw') {
      result = toLdraw(JSON.stringify(payload.model), payload.name);
    } else {
      throw new Error(`unknown message ${type}`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
