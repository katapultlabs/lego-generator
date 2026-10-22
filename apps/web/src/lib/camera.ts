import * as THREE from 'three';

/**
 * Unit vector from the model center toward a camera that sees it from the photo's side, swung round
 * for a 3/4 look. Mirrors the 3D view's default pose (rotated back by any quarter turns applied there).
 */
export function cameraDirFor(
  photoView: [number, number, number],
  upAxis: 'y' | 'z',
  turn: number,
  elevationDeg = 24,
  azimuthDeg = 25,
): THREE.Vector3 {
  const v = upAxis === 'z' ? new THREE.Vector3(photoView[0], photoView[2], -photoView[1]) : new THREE.Vector3(...photoView);
  const horiz = new THREE.Vector3(v.x, 0, v.z);
  if (horiz.lengthSq() < 1e-6) horiz.set(0, 0, 1);
  horiz.normalize();
  const baseEl = Math.asin(THREE.MathUtils.clamp(v.clone().normalize().y, -1, 1));
  const right = new THREE.Vector3().crossVectors(horiz.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize();
  const el = baseEl + THREE.MathUtils.degToRad(elevationDeg);
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const dir = horiz
    .clone()
    .multiplyScalar(Math.cos(az))
    .addScaledVector(right, Math.sin(az))
    .multiplyScalar(Math.cos(el))
    .add(new THREE.Vector3(0, Math.sin(el), 0))
    .normalize();
  return dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (-turn * Math.PI) / 2);
}

/** Position `camera` along `dir` from the box center so every corner of `box` fits with a small margin. */
export function fitCamera(camera: THREE.PerspectiveCamera, box: THREE.Box3, dir: THREE.Vector3, aspect: number, fill = 0.9): void {
  camera.aspect = aspect;
  camera.fov = 30;
  camera.near = 0.5;
  camera.far = 2000;
  camera.updateProjectionMatrix();
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  let dist = radius * 4;
  const p = new THREE.Vector3();
  for (let it = 0; it < 8; it++) {
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    let m = 0;
    for (const c of corners) {
      p.copy(c).project(camera);
      m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
    }
    dist = Math.max(radius * 1.2, dist * (m / fill));
  }
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
}
