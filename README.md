# lego-generator

Take a photo of something you love — a car, a bird, a house — and get a buildable brick model of it:
a 3D build you can explore, step-by-step instructions you can print, and a parts list you can order.

```
photo ─SAM 3 / BiRefNet cutout─▶ subject ─TRELLIS.2 (~40 s) or Hunyuan3D 3.1 (~6 min)─▶ textured 3D model
      ─Rust/WASM brick engine (~100 ms, in the browser)─▶ bricks + plates + slopes, build steps, parts list
```

It aims for a charming, recognizable interpretation in real bricks — not a perfect replica.
A proof of concept from [Katapult Labs](https://github.com/katapultlabs); contributions welcome.

## What it does

- **Photo → 3D:** cuts the subject out (SAM 3 with a text prompt like "bird", BiRefNet otherwise), then
  generates a textured 3D model with TRELLIS.2 or Hunyuan3D 3.1 on [fal.ai](https://fal.ai).
- **3D → bricks** (`crates/brick-core`, Rust, runs in the browser as WebAssembly):
  - voxelizes on a plate-height stud grid, coloring each cell from the surface facing open air;
  - reduces colors (k-means in Lab, chroma boost, shading merge) and snaps them to real brick colors;
  - lays bricks in interlocking courses with plates for surface detail, smooths stair-steps with
    30° slopes, and repairs loose parts so the model holds together;
  - numbers build steps and exports LDraw (`.ldr`), CSV and a BrickLink wanted list.
- **Viewer** (`apps/web`, React Three Fiber): your photo beside the model, live options, build playback,
  loose-part highlighting, a gallery of past generations, and an **Instructions** mode (cover, parts
  inventory, step pages) you can print or save as PDF.

## Layout

| Path | What |
|---|---|
| `crates/brick-core` | The engine. Debug helpers: `cargo run --release -p brick-core --example hues -- model.glb` |
| `crates/brick-cli` | `brickify model.glb --studs 32 [--bricks\|--plates] [--no-slopes] [--hollow N] [--colors N] [--vivid F]` → JSON, `.ldr`, CSV, BrickLink XML, PNG preview |
| `crates/brick-wasm` | WebAssembly bindings for the web app |
| `apps/web` | Viewer; `apps/web/server/api.ts` is the dev-server API (streamed generation, saved generations in `samples/generated/<id>/`) |
| `tools/generate` | Photo → cutout → GLB via fal.ai (CLI + module used by the dev server) |

## Run it

Needs Rust, `wasm-pack` (`cargo install wasm-pack`), pnpm, and a [fal.ai](https://fal.ai) API key
(about $0.30–0.40 per photo). Without a key you can still load GLB files and the sample.

The key is read from `FAL_KEY`, or on macOS from the Keychain item `lego-generator-fal`:

```sh
security add-generic-password -U -s lego-generator-fal -a FAL_KEY -w   # paste the key when prompted
```

```sh
pnpm --dir tools/generate install
cd apps/web && pnpm install && pnpm dev     # http://localhost:5173
```

Command line:

```sh
pnpm --dir tools/generate generate ../../samples/photos/beetle.jpg --subject car [--model hunyuan-3.1]
cargo run --release -p brick-cli -- samples/generated/beetle.trellis-2.glb --studs 32
```

## Notes from building it

- Cut the subject out before generating: a bird on a branch in front of foliage came back as a
  painted slab; with a SAM 3 "bird" cutout it came back as a real 3D bird.
- TRELLIS.2 places the photo's camera on −X (screen-right = +Z); Hunyuan3D 3.1 on +Z (screen-right = +X).
- Generated textures bake in lighting (a metallic roof comes out brown next to a red door), so
  colors are clustered per model before snapping to the palette.
- Bricks only on every third plate layer (courses), plates everywhere else, beat letting bricks
  start anywhere: half the parts and far fewer loose ones.

## Not yet

- Restricting each part to the colors it is actually sold in on BrickLink.
- Step camera that zooms in on each step's new parts.
- Multiple photos per object (Hunyuan3D 3.1 accepts extra views).
- Building from an inventory of bricks you already own.

See `CREDITS.md` for sample-asset licenses and trademarks. Code: MIT.
