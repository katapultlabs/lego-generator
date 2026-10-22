# lego-generator (proof of concept)

Photo → 3D model → buildable brick model, in the browser.

```
photo ─SAM 3 / BiRefNet cutout─▶ subject PNG ─TRELLIS.2 (~40 s) or Hunyuan3D 3.1 (~6 min)─▶ textured GLB
      ─Rust/WASM brick engine (~50 ms)─▶ bricks + build steps + parts list
```

## Layout

- `crates/brick-core` — the engine: GLB loading (incl. WebP textures), voxelization on the stud lattice
  with outward-facing color sampling, color reduction (k-means in Lab, chroma boost, shading merge)
  snapped to the LDraw palette with CIEDE2000, greedy brick layout with a rip-up-and-retry repair that
  attaches stray parts to the main piece, LDraw (`.ldr`) and CSV export.
  Debug helpers: `cargo run --release -p brick-core --example hues -- model.glb` (and `probe`).
- `crates/brick-cli` — `brickify model.glb --studs 32 [--plates] [--hollow N] [--colors N] [--vivid F]`
  → JSON, `.ldr`, BOM CSV, isometric PNG preview.
- `crates/brick-wasm` — WebAssembly bindings used by the web app.
- `apps/web` — Vite + React Three Fiber viewer; `apps/web/server/api.ts` is the dev-server API
  (generation with streamed progress, saved generations under `samples/generated/<id>/`).
- `tools/generate` — photo → cutout → GLB via fal.ai (CLI + module used by the dev server).

## fal.ai key

Read from `FAL_KEY` if set, else from the macOS Keychain item `lego-generator-fal`. One-time setup:

```sh
security add-generic-password -U -s lego-generator-fal -a FAL_KEY -w   # paste the key when prompted
```

## Run

Needs Rust, `wasm-pack` (`cargo install wasm-pack`) and pnpm.

```sh
pnpm --dir tools/generate install
cd apps/web && pnpm install && pnpm dev     # http://localhost:5173
```

Batch photos to GLBs, then bricks:

```sh
pnpm --dir tools/generate generate ../../samples/photos/beetle.jpg --subject car [--model hunyuan-3.1]
cargo run --release -p brick-cli -- samples/generated/beetle.trellis-2.glb --studs 32
```

## Notes from testing

- Cut the subject out before generating: a bird on a branch in front of foliage came back from
  TRELLIS.2 as a painted slab; with a SAM 3 "bird" cutout it came back as a real 3D bird.
- TRELLIS.2 puts the photo's camera on −X (screen-right = +Z); Hunyuan3D 3.1 on +Z (screen-right = +X).
- On the bird, Hunyuan3D 3.1 kept the perched pose and crown color better; TRELLIS.2 was 9× faster.
