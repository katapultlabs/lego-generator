import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { BrickModel } from '../types';

const GAP = 0.03; // visible seam between neighbouring bricks, in studs
const DROP_DUR = 0.8; // seconds for one brick to fall into place
const STUD_RADIUS = 0.3;
const STUD_HEIGHT = 0.2;

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

/**
 * All per-brick state lives in typed arrays and is written straight into InstancedMesh buffers, so
 * ~20k bricks (and their studs) cost one draw call per footprint plus one for studs.
 */
export function createRig(model: BrickModel) {
  const { bricks, dims, units, palette } = model;
  const n = bricks.length;
  const h = units.layerLdu / units.studLdu;
  const offX = dims.x / 2;
  const offZ = dims.z / 2;
  const colors = new Map(palette.map((p) => [p.code, new THREE.Color(p.hex)]));
  const fallback = new THREE.Color('#9a9a9a');

  const cx = new Float32Array(n);
  const cy = new Float32Array(n);
  const cz = new Float32Array(n);
  const stepOf = new Int32Array(n);
  const layerOf = new Int32Array(n);
  const delay = new Float32Array(n);
  const rgb = new Float32Array(n * 3);
  const start = new Float32Array(n).fill(-1);
  const yoff = new Float32Array(n);
  const vis = new Uint8Array(n);

  const byFootprint = new Map<string, number[]>();
  const tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const b = bricks[i];
    cx[i] = b.x + b.w / 2 - offX;
    cy[i] = b.y * h + h / 2;
    cz[i] = b.z + b.d / 2 - offZ;
    stepOf[i] = b.step;
    layerOf[i] = b.y;
    const c = colors.get(b.color) ?? fallback;
    tmp.copy(c);
    rgb[i * 3] = tmp.r;
    rgb[i * 3 + 1] = tmp.g;
    rgb[i * 3 + 2] = tmp.b;
    // build "wave" across each layer, plus a little jitter
    const wave = (b.x + b.z) / Math.max(1, dims.x + dims.z);
    delay[i] = wave * 0.5 + ((i * 2654435761) % 1000) / 1000 * 0.12;
    const key = `${b.w}x${b.d}`;
    const arr = byFootprint.get(key);
    if (arr) arr.push(i);
    else byFootprint.set(key, [i]);
  }

  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
    envMapIntensity: 1,
  });

  const root = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const segments = n > 8000 ? 1 : 2;
  const radius = Math.min(0.05, (h - GAP) / 3);

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
  for (const [key, list] of byFootprint) {
    const [w, d] = key.split('x').map(Number);
    const geo = new RoundedBoxGeometry(w - GAP, h - GAP, d - GAP, segments, radius);
    geometries.push(geo);
    groups.push({ mesh: makeInstanced(geo, list.length, true), indices: Int32Array.from(list) });
  }

  // ---- studs: one per top cell, skipping those permanently buried under a brick placed no later
  const occ = new Int32Array(dims.x * dims.y * dims.z); // step of brick at cell (0 = empty)
  const cell = (x: number, y: number, z: number) => (y * dims.z + z) * dims.x + x;
  for (const b of bricks)
    for (let k = 0; k < b.d; k++)
      for (let j = 0; j < b.w; j++) {
        const x = b.x + j, z = b.z + k;
        if (x < dims.x && z < dims.z && b.y < dims.y) occ[cell(x, b.y, z)] = b.step;
      }
  const sx: number[] = [], sy: number[] = [], sz: number[] = [], sb: number[] = [], sc: number[] = [];
  for (let i = 0; i < n; i++) {
    const b = bricks[i];
    for (let k = 0; k < b.d; k++)
      for (let j = 0; j < b.w; j++) {
        const x = b.x + j, z = b.z + k;
        let cover = Infinity;
        if (b.y + 1 < dims.y && x < dims.x && z < dims.z) {
          const above = occ[cell(x, b.y + 1, z)];
          if (above > 0) {
            if (above <= b.step) continue; // never visible
            cover = above;
          }
        }
        sx.push(x + 0.5 - offX);
        sy.push((b.y + 1) * h - GAP / 2);
        sz.push(z + 0.5 - offZ);
        sb.push(i);
        sc.push(cover);
      }
  }
  const studCount = sb.length;
  const studGeo = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, n > 8000 ? 10 : 16);
  studGeo.translate(0, STUD_HEIGHT / 2 - 0.01, 0);
  geometries.push(studGeo);
  const studMesh = makeInstanced(studGeo, studCount, true);

  const dropH = 5 + h * 3;
  const explodeGap = h * 0.85;

  function rebuild(step: number, now: number, explode: number): boolean {
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

    for (const g of groups) {
      const mArr = g.mesh.instanceMatrix.array as Float32Array;
      const cArr = g.mesh.instanceColor!.array as Float32Array;
      let c = 0;
      for (let k = 0; k < g.indices.length; k++) {
        const i = g.indices[k];
        if (!vis[i]) continue;
        const o = c * 16;
        mArr[o + 12] = cx[i];
        mArr[o + 13] = cy[i] + yoff[i];
        mArr[o + 14] = cz[i];
        const co = c * 3;
        cArr[co] = rgb[i * 3];
        cArr[co + 1] = rgb[i * 3 + 1];
        cArr[co + 2] = rgb[i * 3 + 2];
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
        const co = c * 3;
        cArr[co] = rgb[i * 3];
        cArr[co + 1] = rgb[i * 3 + 1];
        cArr[co + 2] = rgb[i * 3 + 2];
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

  return { group: root, rebuild, onStepChange, dispose, studCount };
}

interface Props {
  model: BrickModel;
  /** Bricks with step <= this are shown. */
  step: number;
  exploded: boolean;
}

export function BrickModelView({ model, step, exploded }: Props) {
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
    invalidate();
  }, [rig, step, exploded, invalidate]);

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
      m.animating = rig.rebuild(step, now, m.e);
      m.dirty = false;
    }
    if (m.animating || moving) invalidate();
  });

  return <primitive object={rig.group} />;
}
