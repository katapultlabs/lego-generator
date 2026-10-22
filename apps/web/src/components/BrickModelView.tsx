import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { BrickModel } from '../types';
import { FACING_ANGLE, GAP, STUD_HEIGHT, boxGeometry, brickMaterial, slopeGeometry, studGeometry } from '../lib/partGeometry';

const DROP_DUR = 0.8; // seconds for one brick to fall into place

function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

interface Group {
  mesh: THREE.InstancedMesh;
  indices: Int32Array;
}

/** How parts are tinted when the rig is rebuilt. */
export interface RigStyle {
  /** Parts from earlier steps are shown washed out; this step and later are full color. */
  focusStep?: number;
  /** Tint parts that are not attached to the model red (pulsing) and wash out everything else. */
  loose?: boolean;
}

const LOOSE_RED = new THREE.Color('#e5121b');

/**
 * All per-part state lives in typed arrays and is written straight into InstancedMesh buffers, so
 * ~20k parts (and their studs) cost one draw call per (shape, footprint, height) plus one for studs.
 */
export function createRig(model: BrickModel) {
  const { bricks, dims, units, palette } = model;
  const n = bricks.length;
  const lh = units.layerLdu / units.studLdu; // world height of one layer
  const offX = dims.x / 2;
  const offZ = dims.z / 2;
  const colors = new Map(palette.map((p) => [p.code, new THREE.Color(p.hex)]));
  const fallback = new THREE.Color('#9a9a9a');

  const cx = new Float32Array(n);
  const cy = new Float32Array(n);
  const cz = new Float32Array(n);
  const rc = new Float32Array(n).fill(1); // cos / sin of the part's yaw (slopes)
  const rs = new Float32Array(n);
  const stepOf = new Int32Array(n);
  const layerOf = new Int32Array(n);
  const delay = new Float32Array(n);
  const rgb = new Float32Array(n * 3);
  const wash = new Float32Array(n * 3); // desaturated, lightened variant
  const loose = new Uint8Array(n);
  const start = new Float32Array(n).fill(-1);
  const yoff = new Float32Array(n);
  const vis = new Uint8Array(n);
  let looseCount = 0;

  const byKind = new Map<string, number[]>();
  const tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const b = bricks[i];
    const hh = b.h ?? 1;
    const slope = b.shape === 'slope';
    cx[i] = b.x + b.w / 2 - offX;
    cy[i] = (b.y + hh / 2) * lh;
    cz[i] = b.z + b.d / 2 - offZ;
    if (slope) {
      const a = FACING_ANGLE[b.facing ?? '+x'];
      rc[i] = Math.cos(a);
      rs[i] = Math.sin(a);
    }
    stepOf[i] = b.step;
    layerOf[i] = b.y;
    if (b.floating) {
      loose[i] = 1;
      looseCount++;
    }
    const c = colors.get(b.color) ?? fallback;
    rgb[i * 3] = c.r;
    rgb[i * 3 + 1] = c.g;
    rgb[i * 3 + 2] = c.b;
    // washed-out classic-instruction look for parts from earlier steps
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    tmp.setRGB(c.r + (lum - c.r) * 0.55, c.g + (lum - c.g) * 0.55, c.b + (lum - c.b) * 0.55);
    wash[i * 3] = tmp.r + (1 - tmp.r) * 0.3;
    wash[i * 3 + 1] = tmp.g + (1 - tmp.g) * 0.3;
    wash[i * 3 + 2] = tmp.b + (1 - tmp.b) * 0.3;
    // build "wave" across each layer, plus a little jitter
    const wave = (b.x + b.z) / Math.max(1, dims.x + dims.z);
    delay[i] = wave * 0.5 + ((i * 2654435761) % 1000) / 1000 * 0.12;
    const key = `${slope ? 'slope' : 'box'}|${b.w}x${b.d}x${hh}`;
    const arr = byKind.get(key);
    if (arr) arr.push(i);
    else byKind.set(key, [i]);
  }

  const material = brickMaterial();
  const root = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const segments = n > 8000 ? 1 : 2;

  const makeInstanced = (geo: THREE.BufferGeometry, cap: number, shadows: boolean) => {
    const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, cap));
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const m = mesh.instanceMatrix.array as Float32Array;
    for (let i = 0; i < cap; i++) {
      m[i * 16] = 1;
      m[i * 16 + 5] = 1;
      m[i * 16 + 10] = 1;
      m[i * 16 + 15] = 1;
    }
    mesh.count = 0;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    mesh.frustumCulled = false;
    root.add(mesh);
    return mesh;
  };

  const groups: Group[] = [];
  for (const [key, list] of byKind) {
    const [shape, dim] = key.split('|');
    const [w, d, hh] = dim.split('x').map(Number);
    const geo = shape === 'slope' ? slopeGeometry(hh * lh) : boxGeometry(w, d, hh * lh, segments);
    geometries.push(geo);
    groups.push({ mesh: makeInstanced(geo, list.length, true), indices: Int32Array.from(list) });
  }

  // ---- studs: one per top cell of a box part, skipped where another part sits directly on top
  // (a part placed no later is buried for good; a later one buries the stud from its step on).
  const occ = new Int32Array(dims.x * dims.y * dims.z); // step of the part at cell (0 = empty)
  const cell = (x: number, y: number, z: number) => (y * dims.z + z) * dims.x + x;
  for (const b of bricks)
    for (let yy = b.y; yy < b.y + (b.h ?? 1); yy++)
      for (let k = 0; k < b.d; k++)
        for (let j = 0; j < b.w; j++) {
          const x = b.x + j, z = b.z + k;
          if (x < dims.x && z < dims.z && yy < dims.y) occ[cell(x, yy, z)] = b.step;
        }
  const sx: number[] = [], sy: number[] = [], sz: number[] = [], sb: number[] = [], sc: number[] = [];
  for (let i = 0; i < n; i++) {
    const b = bricks[i];
    if (b.shape === 'slope') continue;
    const top = b.y + (b.h ?? 1);
    for (let k = 0; k < b.d; k++)
      for (let j = 0; j < b.w; j++) {
        const x = b.x + j, z = b.z + k;
        let cover = Infinity;
        if (top < dims.y && x < dims.x && z < dims.z) {
          const above = occ[cell(x, top, z)];
          if (above > 0) {
            if (above <= b.step) continue; // never visible
            cover = above;
          }
        }
        sx.push(x + 0.5 - offX);
        sy.push(top * lh - GAP / 2);
        sz.push(z + 0.5 - offZ);
        sb.push(i);
        sc.push(cover);
      }
  }
  const studCount = sb.length;
  const studGeo = studGeometry(n > 8000 ? 10 : 16);
  geometries.push(studGeo);
  const studMesh = makeInstanced(studGeo, studCount, true);

  const dropH = 5 + lh * 3;
  const explodeGap = lh * 0.85;

  function rebuild(step: number, now: number, explode: number, style: RigStyle = {}): boolean {
    let animating = false;
    for (let i = 0; i < n; i++) {
      vis[i] = 0;
      if (stepOf[i] > step) continue;
      let off = 0;
      const s = start[i];
      if (s >= 0) {
        const t = now - s;
        if (t < 0) { animating = true; continue; }
        if (t >= DROP_DUR) start[i] = -1;
        else { animating = true; off = (1 - easeOutBounce(t / DROP_DUR)) * dropH; }
      }
      vis[i] = 1;
      yoff[i] = off + layerOf[i] * explodeGap * explode;
    }

    const highlight = !!style.loose && looseCount > 0;
    const pulse = 0.5 + 0.5 * Math.sin(now * 5);
    if (highlight) animating = true;
    const focus = style.focusStep ?? 0;
    const setColor = (arr: Float32Array, o: number, i: number) => {
      let src = rgb;
      if (highlight) {
        if (loose[i]) {
          const k = 0.55 + 0.4 * pulse;
          arr[o] = rgb[i * 3] + (LOOSE_RED.r - rgb[i * 3]) * k;
          arr[o + 1] = rgb[i * 3 + 1] + (LOOSE_RED.g - rgb[i * 3 + 1]) * k;
          arr[o + 2] = rgb[i * 3 + 2] + (LOOSE_RED.b - rgb[i * 3 + 2]) * k;
          return;
        }
        src = wash;
      } else if (focus > 0 && stepOf[i] < focus) src = wash;
      arr[o] = src[i * 3];
      arr[o + 1] = src[i * 3 + 1];
      arr[o + 2] = src[i * 3 + 2];
    };

    for (const g of groups) {
      const mArr = g.mesh.instanceMatrix.array as Float32Array;
      const cArr = g.mesh.instanceColor!.array as Float32Array;
      let c = 0;
      for (let k = 0; k < g.indices.length; k++) {
        const i = g.indices[k];
        if (!vis[i]) continue;
        const o = c * 16;
        mArr[o] = rc[i];
        mArr[o + 2] = -rs[i];
        mArr[o + 8] = rs[i];
        mArr[o + 10] = rc[i];
        mArr[o + 12] = cx[i];
        mArr[o + 13] = cy[i] + yoff[i];
        mArr[o + 14] = cz[i];
        setColor(cArr, c * 3, i);
        c++;
      }
      g.mesh.count = c;
      g.mesh.instanceMatrix.needsUpdate = true;
      g.mesh.instanceColor!.needsUpdate = true;
    }

    {
      const mArr = studMesh.instanceMatrix.array as Float32Array;
      const cArr = studMesh.instanceColor!.array as Float32Array;
      let c = 0;
      for (let k = 0; k < studCount; k++) {
        const i = sb[k];
        if (!vis[i] || sc[k] <= step) continue;
        const o = c * 16;
        mArr[o + 12] = sx[k];
        mArr[o + 13] = sy[k] + yoff[i];
        mArr[o + 14] = sz[k];
        setColor(cArr, c * 3, i);
        c++;
      }
      studMesh.count = c;
      studMesh.instanceMatrix.needsUpdate = true;
      studMesh.instanceColor!.needsUpdate = true;
    }
    return animating;
  }

  function onStepChange(prev: number, next: number, now: number) {
    if (next > prev && next - prev <= 2) {
      for (let i = 0; i < n; i++) if (stepOf[i] > prev && stepOf[i] <= next) start[i] = now + delay[i];
    } else if (next < prev) {
      for (let i = 0; i < n; i++) if (stepOf[i] > next) start[i] = -1;
    }
  }

  function dispose() {
    for (const g of geometries) g.dispose();
    material.dispose();
    for (const c of [...root.children]) {
      const m = c as THREE.InstancedMesh;
      m.dispose();
    }
  }

  return { group: root, rebuild, onStepChange, dispose, studCount, looseCount, studHeight: STUD_HEIGHT };
}

interface Props {
  model: BrickModel;
  /** Parts with step <= this are shown. */
  step: number;
  exploded: boolean;
  /** Tint parts that are not attached to the model red. */
  highlightLoose: boolean;
}

export function BrickModelView({ model, step, exploded, highlightLoose }: Props) {
  const rig = useMemo(() => createRig(model), [model]);
  useEffect(() => () => rig.dispose(), [rig]);
  const invalidate = useThree((s) => s.invalidate);

  const meta = useRef<{ rig: ReturnType<typeof createRig> | null; prev: number; e: number; dirty: boolean; animating: boolean }>({
    rig: null,
    prev: step,
    e: exploded ? 1 : 0,
    dirty: true,
    animating: false,
  });

  useEffect(() => {
    meta.current.dirty = true;
    invalidate();
  }, [rig, step, exploded, highlightLoose, invalidate]);

  useFrame((_, delta) => {
    const m = meta.current;
    const now = performance.now() / 1000;
    if (m.rig !== rig) {
      m.rig = rig;
      m.prev = step; // new model: show instantly, no drop animation
      m.dirty = true;
    }
    if (step !== m.prev) {
      rig.onStepChange(m.prev, step, now);
      m.prev = step;
      m.dirty = true;
    }
    const target = exploded ? 1 : 0;
    let moving = false;
    if (m.e !== target) {
      const dt = Math.min(delta, 1 / 30);
      m.e += (target - m.e) * (1 - Math.exp(-dt * 6));
      if (Math.abs(target - m.e) < 0.002) m.e = target;
      else moving = true;
      m.dirty = true;
    }
    if (m.dirty || m.animating) {
      m.animating = rig.rebuild(step, now, m.e, { loose: highlightLoose });
      m.dirty = false;
    }
    if (m.animating || moving) invalidate();
  });

  return <primitive object={rig.group} />;
}
