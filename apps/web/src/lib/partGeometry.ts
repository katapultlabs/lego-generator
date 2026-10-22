// Geometry shared by the live 3D view and the offscreen instruction renderer.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Facing } from '../types';

export const GAP = 0.03; // visible seam between neighbouring parts, in studs
export const STUD_RADIUS = 0.3;
export const STUD_HEIGHT = 0.2;

/** Rotation about Y that turns a slope built descending toward +x so it descends toward `facing`. */
export const FACING_ANGLE: Record<Facing, number> = {
  '+x': 0,
  '-x': Math.PI,
  '+z': -Math.PI / 2,
  '-z': Math.PI / 2,
};

/** Rectangular brick or plate, centred on its origin. `height` is in world units. */
export function boxGeometry(w: number, d: number, height: number, segments: number): THREE.BufferGeometry {
  const radius = Math.max(0.005, Math.min(0.05, (height - GAP) / 3));
  return new RoundedBoxGeometry(w - GAP, height - GAP, d - GAP, segments, radius);
}

/**
 * LEGO 30 degree "cheese" slope (1x1), centred on its origin, descending toward +x.
 * Side profile: a small vertical lip at the low front edge, a straight climb that reaches full
 * height 80% of the way back, then a short flat top.
 */
export function slopeGeometry(height: number): THREE.BufferGeometry {
  const s = 1 - GAP;
  const H = height - GAP;
  const lip = Math.min(0.2, H * 0.4); // 4 LDU
  const x0 = -s / 2;
  const x1 = s / 2;
  const xTop = x1 - 0.8 * s;
  const shape = new THREE.Shape();
  shape.moveTo(x1, 0);
  shape.lineTo(x1, lip);
  shape.lineTo(xTop, H);
  shape.lineTo(x0, H);
  shape.lineTo(x0, 0);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: s, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, -H / 2, -s / 2);
  return geo;
}

export function studGeometry(segments: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, segments);
  g.translate(0, STUD_HEIGHT / 2 - 0.01, 0);
  return g;
}

export function brickMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
    envMapIntensity: 1,
  });
}
