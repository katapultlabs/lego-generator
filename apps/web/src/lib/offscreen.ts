// Offscreen rendering for the instruction booklet: ONE shared WebGLRenderer, jobs run one at a time,
// results are cached PNG object URLs.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { BrickModel, Facing } from '../types';
import { createRig } from '../components/BrickModelView';
import { cameraDirFor, fitCamera } from './camera';
import { FACING_ANGLE, GAP, STUD_HEIGHT, boxGeometry, brickMaterial, slopeGeometry, studGeometry } from './partGeometry';

// ------------------------------------------------------------ shared renderer + serial queue

interface Shared {
  renderer: THREE.WebGLRenderer;
  env: THREE.Texture;
}
let shared: Shared | null = null;

function getShared(): Shared {
  if (shared) return shared;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setClearColor(0x000000, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  shared = { renderer, env };
  return shared;
}

let queue: Promise<unknown> = Promise.resolve();
/** Run `job` after every earlier job, yielding to the browser in between so the page stays responsive. */
function enqueue<T>(job: () => Promise<T> | T): Promise<T> {
  const run = queue.then(async () => {
    await new Promise((r) => setTimeout(r, 0));
    return job();
  });
  queue = run.catch(() => {});
  return run;
}

function makeScene(): THREE.Scene {
  const { env } = getShared();
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.environmentIntensity = 0.9;
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(0.7, 1.4, 0.9).multiplyScalar(40);
  scene.add(key);
  return scene;
}

async function snapshot(scene: THREE.Scene, camera: THREE.PerspectiveCamera, w: number, h: number): Promise<string> {
  const { renderer } = getShared();
  renderer.setSize(w, h, false);
  renderer.render(scene, camera);
  const blob = await new Promise<Blob | null>((res) => renderer.domElement.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not encode render');
  return URL.createObjectURL(blob);
}

// ------------------------------------------------------------ model renders (hero + build steps)

export interface ModelRenderOptions {
  photoView: [number, number, number];
  upAxis: 'y' | 'z';
  turn: number;
  /** Pixel size of each step image; pick it to match the page cell it is shown in. */
  size?: { w: number; h: number };
}

export class ModelRenderer {
  private rig: ReturnType<typeof createRig>;
  private scene = makeScene();
  private camera = new THREE.PerspectiveCamera();
  private heroCamera = new THREE.PerspectiveCamera();
  private size: { w: number; h: number };
  private steps = new Map<number, string>();
  private inflight = new Map<number, Promise<string | null>>();
  private wanted = new Map<number, number>();
  private heroUrl: Promise<string> | null = null;
  private dead = false;

  constructor(private model: BrickModel, opts: ModelRenderOptions) {
    this.size = opts.size ?? { w: 840, h: 630 };
    this.rig = createRig(model);
    this.scene.add(this.rig.group);
    const lh = model.units.layerLdu / model.units.studLdu;
    const box = new THREE.Box3(
      new THREE.Vector3(-model.dims.x / 2, 0, -model.dims.z / 2),
      new THREE.Vector3(model.dims.x / 2, model.dims.y * lh + STUD_HEIGHT, model.dims.z / 2),
    );
    const dir = cameraDirFor(opts.photoView, opts.upAxis, opts.turn, 26, 28);
    fitCamera(this.camera, box, dir, this.size.w / this.size.h, 0.96);
    fitCamera(this.heroCamera, box, dir, 4 / 3, 0.94);
  }

  total(): number {
    return this.model.stats.steps;
  }

  peek(step: number): string | null {
    return this.steps.get(step) ?? null;
  }

  /** Mark `step` as wanted (on screen) so a queued render is not skipped. Pair with release(). */
  want(step: number) {
    this.wanted.set(step, (this.wanted.get(step) ?? 0) + 1);
  }
  release(step: number) {
    const n = (this.wanted.get(step) ?? 0) - 1;
    if (n <= 0) this.wanted.delete(step);
    else this.wanted.set(step, n);
  }

  /** The model after `step`, with that step's parts at full color and earlier ones washed out. */
  step(step: number, force = false): Promise<string | null> {
    const hit = this.steps.get(step);
    if (hit) return Promise.resolve(hit);
    const flying = this.inflight.get(step);
    if (flying) return flying;
    const p = enqueue(async () => {
      if (this.dead) return null;
      if (!force && !this.wanted.has(step)) return null; // scrolled past before its turn
      this.rig.rebuild(step, 0, 0, { focusStep: step });
      const url = await snapshot(this.scene, this.camera, this.size.w, this.size.h);
      if (this.dead) {
        URL.revokeObjectURL(url);
        return null;
      }
      this.steps.set(step, url);
      return url;
    }).finally(() => this.inflight.delete(step));
    this.inflight.set(step, p);
    return p;
  }

  /** The finished model in full color. */
  hero(): Promise<string> {
    if (!this.heroUrl) {
      this.heroUrl = enqueue(async () => {
        this.rig.rebuild(Infinity, 0, 0, {});
        return snapshot(this.scene, this.heroCamera, 1200, 900);
      });
    }
    return this.heroUrl;
  }

  /** Render every step (the print path). `onProgress(done, total)` fires after each one. */
  async prepareAll(onProgress: (done: number, total: number) => void, cancelled: () => boolean): Promise<void> {
    const total = this.total();
    let done = 0;
    onProgress(0, total);
    for (let s = 1; s <= total; s++) {
      if (cancelled() || this.dead) return;
      await this.step(s, true);
      onProgress(++done, total);
    }
  }

  dispose() {
    this.dead = true;
    for (const u of this.steps.values()) URL.revokeObjectURL(u);
    this.steps.clear();
    this.rig.dispose();
  }
}

// ------------------------------------------------------------ single-part thumbnails

export interface PartSpec {
  shape: 'box' | 'slope';
  w: number;
  d: number;
  /** Height in layers. */
  h: number;
  facing?: Facing;
  hex: string;
  /** World height of one layer. */
  layerH: number;
}

export const partKey = (s: PartSpec) => `${s.shape}|${s.w}x${s.d}x${s.h}|${s.facing ?? ''}|${s.hex}|${s.layerH}`;

const partCache = new Map<string, Promise<string>>();
const PART_PX = 256;

/** A small 3/4 render of one part in one color; cached by shape + color. */
export function partImage(spec: PartSpec): Promise<string> {
  const key = partKey(spec);
  let p = partCache.get(key);
  if (!p) {
    p = enqueue(async () => {
      const scene = makeScene();
      const material = brickMaterial();
      material.color.set(spec.hex);
      const height = spec.h * spec.layerH;
      const geos: THREE.BufferGeometry[] = [];
      const group = new THREE.Group();
      const slope = spec.shape === 'slope';
      const body = slope ? slopeGeometry(height) : boxGeometry(spec.w, spec.d, height, 2);
      geos.push(body);
      const mesh = new THREE.Mesh(body, material);
      mesh.position.y = height / 2;
      if (slope) mesh.rotation.y = FACING_ANGLE[spec.facing ?? '+x'];
      group.add(mesh);
      if (!slope) {
        const stud = studGeometry(18);
        geos.push(stud);
        for (let k = 0; k < spec.d; k++)
          for (let j = 0; j < spec.w; j++) {
            const s = new THREE.Mesh(stud, material);
            s.position.set(j + 0.5 - spec.w / 2, height - GAP / 2, k + 0.5 - spec.d / 2);
            group.add(s);
          }
      }
      scene.add(group);
      const box = new THREE.Box3(
        new THREE.Vector3(-spec.w / 2, 0, -spec.d / 2),
        new THREE.Vector3(spec.w / 2, height + (slope ? 0 : STUD_HEIGHT), spec.d / 2),
      );
      const camera = new THREE.PerspectiveCamera();
      // From the front-right, so a slope that descends toward +x shows its face.
      fitCamera(camera, box, new THREE.Vector3(0.75, 0.62, 0.95).normalize(), 1, 0.86);
      const url = await snapshot(scene, camera, PART_PX, PART_PX);
      for (const g of geos) g.dispose();
      material.dispose();
      return url;
    });
    partCache.set(key, p);
  }
  return p;
}

export function peekPartImage(spec: PartSpec): string | null {
  return partUrls.get(partKey(spec)) ?? null;
}
const partUrls = new Map<string, string>();
export async function loadPartImage(spec: PartSpec): Promise<string> {
  const url = await partImage(spec);
  partUrls.set(partKey(spec), url);
  return url;
}
