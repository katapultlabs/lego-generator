import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Grid, Lightformer, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BrickModel, ViewMode } from '../types';
import { BrickModelView } from './BrickModelView';
import { SourceMeshView } from './SourceMeshView';

interface ViewerProps {
  model: BrickModel | null;
  meshUrl: string | null;
  view: ViewMode;
  step: number;
  exploded: boolean;
  upAxis: 'y' | 'z';
  /** bump to re-frame the camera */
  recenter: number;
  onMeshError: (msg: string) => void;
}

const DEFAULT_SIZE = new THREE.Vector3(24, 14, 24);

export function modelSize(model: BrickModel | null): THREE.Vector3 {
  if (!model) return DEFAULT_SIZE;
  const h = model.units.layerLdu / model.units.studLdu;
  return new THREE.Vector3(model.dims.x, model.dims.y * h, model.dims.z);
}

export function Viewer(props: ViewerProps) {
  const { model, meshUrl, view, step, exploded, upAxis, recenter, onMeshError } = props;
  const size = useMemo(() => modelSize(model), [model]);
  const sizeKey = `${size.x}|${size.y}|${size.z}`;
  const stableSize = useMemo(() => size, [sizeKey]);
  const radius = Math.max(stableSize.x, stableSize.y, stableSize.z);

  const showBricks = !!model && (view === 'bricks' || view === 'both');
  const showMesh = !!meshUrl && (view === 'mesh' || view === 'both');

  return (
    <Canvas
      frameloop="demand"
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ fov: 35, near: 0.1, far: 4000, position: [30, 24, 38] }}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.NeutralToneMapping }}
    >
      <Lighting radius={radius} />
      <Ground radius={radius} />
      <Suspense fallback={null}>
        {showMesh && meshUrl && (
          <MeshBoundary onError={onMeshError} resetKey={meshUrl}>
            <SourceMeshView url={meshUrl} fit={stableSize} upAxis={upAxis} opacity={view === 'both' ? 0.38 : 1} />
          </MeshBoundary>
        )}
      </Suspense>
      {showBricks && model && <BrickModelView model={model} step={step} exploded={exploded} />}
      <OrbitControls makeDefault enableDamping dampingFactor={0.09} maxPolarAngle={Math.PI / 2 - 0.02} minDistance={2} />
      <CameraRig size={stableSize} recenter={recenter} />
    </Canvas>
  );
}

function Lighting({ radius }: { radius: number }) {
  const r = Math.max(radius, 8);
  return (
    <>
      <Environment resolution={256} environmentIntensity={0.85}>
        <color attach="background" args={['#cfc9bd']} />
        <Lightformer form="rect" intensity={3} position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} />
        <Lightformer form="rect" intensity={2} position={[-9, 3, 4]} rotation-y={Math.PI / 2} scale={[8, 5, 1]} />
        <Lightformer form="rect" intensity={1.4} position={[9, 2, -3]} rotation-y={-Math.PI / 2} scale={[8, 4, 1]} />
        <Lightformer form="ring" intensity={1.2} color="#ffe9c4" position={[0, 3, 9]} scale={6} />
      </Environment>
      <directionalLight
        castShadow
        intensity={2.4}
        position={[r * 0.9, r * 1.6, r * 0.7]}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-near={0.5}
        shadow-camera-far={r * 6}
        shadow-camera-left={-r * 1.4}
        shadow-camera-right={r * 1.4}
        shadow-camera-top={r * 1.4}
        shadow-camera-bottom={-r * 1.4}
      />
    </>
  );
}

function Ground({ radius }: { radius: number }) {
  const r = Math.max(radius, 8);
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.002} receiveShadow>
        <planeGeometry args={[r * 30, r * 30]} />
        <shadowMaterial opacity={0.3} />
      </mesh>
      <Grid
        position-y={0.001}
        args={[1, 1]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#b4ad9f"
        sectionSize={8}
        sectionThickness={1}
        sectionColor="#9d9585"
        fadeDistance={r * 5}
        fadeStrength={1.6}
        infiniteGrid
      />
    </>
  );
}

/** Smoothly dolly the camera so the whole model fits, keeping the user's viewing direction. */
function CameraRig({ size, recenter }: { size: THREE.Vector3; recenter: number }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const goal = useRef<{ target: THREE.Vector3; dist: number } | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (!controls) return;
    const r = 0.5 * size.length();
    const dist = (r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.0;
    goal.current = { target: new THREE.Vector3(0, size.y * 0.42, 0), dist };
    if (first.current) {
      // snap on first framing
      first.current = false;
      const dir = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(goal.current.target);
      camera.position.copy(goal.current.target).addScaledVector(dir, dist);
      controls.update();
      goal.current = null;
    }
    invalidate();
  }, [size, recenter, controls, camera, invalidate]);

  useEffect(() => {
    if (!controls) return;
    const cancel = () => { goal.current = null; };
    controls.addEventListener('start', cancel);
    return () => controls.removeEventListener('start', cancel);
  }, [controls]);

  useFrame((_, delta) => {
    const g = goal.current;
    if (!g || !controls) return;
    const k = 1 - Math.exp(-Math.min(delta, 1 / 30) * 5);
    const dir = camera.position.clone().sub(controls.target);
    const cur = dir.length();
    dir.normalize();
    controls.target.lerp(g.target, k);
    const next = cur + (g.dist - cur) * k;
    camera.position.copy(controls.target).addScaledVector(dir, next);
    controls.update();
    if (controls.target.distanceTo(g.target) < 0.01 && Math.abs(next - g.dist) < 0.02) goal.current = null;
    invalidate();
  });

  return null;
}

class MeshBoundary extends Component<
  { children: ReactNode; onError: (m: string) => void; resetKey: string },
  { failedKey: string | null }
> {
  state = { failedKey: null as string | null };
  static getDerivedStateFromError() {
    return { failedKey: 'failed' };
  }
  componentDidCatch(err: unknown) {
    this.props.onError(`Could not display the source mesh: ${err instanceof Error ? err.message : String(err)}`);
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failedKey) this.setState({ failedKey: null });
  }
  render() {
    return this.state.failedKey ? null : this.props.children;
  }
}
