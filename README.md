# lego-generator (proof of concept)

Photo → 3D model → buildable brick model, in the browser.

```
photo ──fal.ai TRELLIS.2 (~60 s, ~$0.30)──▶ textured GLB ──Rust/WASM brick engine (~50 ms)──▶ bricks + steps + parts list
```

## Layout

- `crates/brick-core` — the engine: GLB loading (incl. WebP textures), voxelization on the stud lattice
  with outward-facing color sampling, color reduction (k-means in Lab + shading merge) snapped to the
  LDraw palette with CIEDE2000, greedy brick layout with a rip-up-and-retry repair for floating bricks,
  LDraw (`.ldr`) and CSV export.
- `crates/brick-cli` — `brickify model.glb --studs 32 [--plates] [--hollow N]` → JSON, `.ldr`, BOM CSV, PNG preview.
- `crates/brick-wasm` — WebAssembly bindings used by the web app.
- `apps/web` — Vite + React Three Fiber viewer: upload a photo or GLB, tune options live, step-by-step build playback.
- `tools/generate` — photo → GLB via fal.ai (CLI + module used by the dev server).

## Run

Needs Rust, `wasm-pack` (`cargo install wasm-pack`), pnpm, and the 1Password CLI (the fal key is read
from 1Password at runtime; see `.env.example`).

```sh
cp .env.example .env
pnpm --dir tools/generate install
cd apps/web && pnpm install && pnpm dev     # http://localhost:5173
```

`pnpm dev:offline` runs without fal (GLB uploads and the sample still work).

Batch photos to GLBs, then bricks:

```sh
pnpm --dir tools/generate generate ../../samples/photos/beetle.jpg
cargo run --release -p brick-cli -- samples/generated/beetle.glb --studs 32
```
