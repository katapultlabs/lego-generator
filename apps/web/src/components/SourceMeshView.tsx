import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

interface Props {
  url: string;
  /** World-space box (x,z in studs; y in world units) the mesh is scaled to fit inside. */
  fit: THREE.Vector3;
  upAxis: 'y' | 'z';
  opacity: number;
}

/**
 * Renders the source GLB, rotated by upAxis, uniformly scaled to fit `fit`, centred on the origin and
 * resting on the ground. (Assumption: the engine voxelizes the same normalized bounding box.)
 */
export function SourceMeshView({ url, fit, upAxis, opacity }: Props) {
  const gltf = useGLTF(url);
  const invalidate = useThree((s) => s.invalidate);

  const { wrapper, scale, position, materials } = useMemo(() => {
    const clone = gltf.scene.clone(true);
    const mats: THREE.Material[] = [];
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const src = mesh.material;
      const cloned = Array.isArray(src) ? src.map((m) => m.clone()) : src.clone();
      mesh.material = cloned;
      mats.push(...(Array.isArray(cloned) ? cloned : [cloned]));
    });
    const wrap = new THREE.Group();
    wrap.add(clone);
    wrap.rotation.x = upAxis === 'z' ? -Math.PI / 2 : 0;
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrap);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = Math.min(fit.x / (size.x || 1), fit.y / (size.y || 1), fit.z / (size.z || 1));
    return {
      wrapper: wrap,
      scale: s,
      position: new THREE.Vector3(-center.x * s, -box.min.y * s, -center.z * s),
      materials: mats,
    };
  }, [gltf, upAxis, fit]);

  useEffect(() => {
    for (const m of materials) {
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.depthWrite = opacity >= 1;
      m.needsUpdate = true;
    }
    invalidate();
  }, [materials, opacity, invalidate]);

  useEffect(
    () => () => {
      for (const m of materials) m.dispose();
    },
    [materials],
  );

  return (
    <group position={position} scale={scale}>
      <primitive object={wrapper} />
    </group>
  );
}
