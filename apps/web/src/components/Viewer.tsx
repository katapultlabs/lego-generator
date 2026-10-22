import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Grid, Lightformer, OrbitControls, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BrickModel, PhotoMode, ViewMode } from '../types';
import { BrickModelView } from './BrickModelView';
import { SourceMeshView } from './SourceMeshView';

interface ViewerProps {
  model: BrickModel | null;
  meshUrl: string | null;
  view: ViewMode;
  step: number;
  exploded: boolean;
  highlightLoose: boolean;
  upAxis: 'y' | 'z';
  /** bump to re-frame the camera */
  recenter: number;
  /** bump to fly the camera back to the photo view */
  photoViewTick: number;
  /** direction from the model center toward the camera that took the photo (GLB frame, up = +Y) */
  photoView: [number, number, number];
  photoUrl: string | null;
  cutoutUrl: string | null;
  photoMode: PhotoMode;
  /** quarter turns of the model + bricks around Y */
  turn: number;
  onMeshError: (msg: string) => void;
}

const DEFAULT_SIZE = new THREE.Vector3(24, 14, 24);
const FOV = 35;
const VIEW_ELEVATION = THREE.MathUtils.degToRad(20); // lift above the photo's own viewpoint
const VIEW_AZIMUTH = THREE.MathUtils.degToRad(25); // turn away from it for a 3/4 look

export function modelSize(model: BrickModel | null): THREE.Vector3 {
  if (!model) return DEFAULT_SIZE;
  const h = model.units.layerLdu / model.units.studLdu;
  return new THREE.Vector3(model.dims.x, model.dims.y * h, model.dims.z);
}

export function Viewer(props: ViewerProps) {
  const { model, meshUrl, view, step, exploded, highlightLoose, upAxis, recenter, photoViewTick, photoView, photoUrl, cutoutUrl, photoMode, turn, onMeshError } = props;
  const size = useMemo(() => modelSize(model), [model]);
  const sizeKey = `${size.x}|${size.y}|${size.z}`;
  const stableSize = useMemo(() => size, [sizeKey]);
  const radius = Math.max(stableSize.x, stableSize.y, stableSize.z);

  const showBricks = !!model && (view === 'bricks' || view === 'both');
  const showMesh = !!meshUrl && (view === 'mesh' || view === 'both');

  const photoTex = useImageTexture(photoUrl);
  const cutoutTex = useImageTexture(photoMode === 'cutout' ? cutoutUrl : null);
  const printTex = photoMode === 'photo' ? photoTex : photoMode === 'cutout' ? cutoutTex : null;
  // Framing always reserves room for the photo (when there is one) so toggling it does not move the camera.
  const photoAspect = photoUrl && meshUrl ? (photoTex?.aspect ?? 4 / 3) : null;

  const layout = useMemo(
    () => makeLayout(stableSize, photoView, upAxis, photoAspect),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stableSize, photoView[0], photoView[1], photoView[2], upAxis, photoAspect],
  );

  return (
    <Canvas
      frameloop="demand"
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ fov: FOV, near: 0.1, far: 4000, position: [30, 24, 38] }}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.NeutralToneMapping }}
    >
      <Lighting radius={radius * 1.6} />
      <Ground radius={radius} />
      <Turntable turn={turn}>
        <Suspense fallback={null}>
          {showMesh && meshUrl && (
            <MeshBoundary onError={onMeshError} resetKey={meshUrl}>
              <SourceMeshView url={meshUrl} fit={stableSize} upAxis={upAxis} opacity={view === 'both' ? 0.38 : 1} />
            </MeshBoundary>
          )}
        </Suspense>
        {showBricks && model && <BrickModelView model={model} step={step} exploded={exploded} highlightLoose={highlightLoose} />}
      </Turntable>
      {layout.photo && printTex && meshUrl && (
        <PhotoPrint
          tex={printTex.tex}
          aspect={printTex.aspect}
          height={layout.photo.height}
          maxWidth={layout.photo.maxWidth}
          framed={photoMode === 'photo'}
          position={layout.photo.position}
          rotationY={layout.photo.rotationY}
        />
      )}
      <OrbitControls makeDefault enableDamping dampingFactor={0.09} maxPolarAngle={Math.PI / 2 - 0.02} minDistance={2} />
      <CameraRig layout={layout} recenter={recenter} viewTick={photoViewTick} />
    </Canvas>
  );
}

// ------------------------------------------------------------ photo + camera layout

interface Layout {
  /** Where the camera looks. */
  target: THREE.Vector3;
  /** Unit vector from the target toward the default (3/4, lifted) camera. */
  cameraDir: THREE.Vector3;
  /** Extent of everything to frame (model + photo): across the view, up, and deep. */
  width: number;
  height: number;
  depth: number;
  photo: { position: THREE.Vector3; rotationY: number; height: number; maxWidth: number } | null;
  key: string;
}

function makeLayout(size: THREE.Vector3, photoView: [number, number, number], upAxis: 'y' | 'z', photoAspect: number | null): Layout {
  // The Z-up source mesh is stood upright by a -90deg turn about X: (x, y, z) -> (x, z, -y).
  const v = upAxis === 'z' ? new THREE.Vector3(photoView[0], photoView[2], -photoView[1]) : new THREE.Vector3(...photoView);
  const horiz = new THREE.Vector3(v.x, 0, v.z);
  if (horiz.lengthSq() < 1e-6) horiz.set(0, 0, 1);
  horiz.normalize();
  const baseElevation = Math.asin(THREE.MathUtils.clamp(v.clone().normalize().y, -1, 1));
  // screen-right for a camera that looks along -horiz
  const right = new THREE.Vector3().crossVectors(horiz.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize();

  const el = baseElevation + VIEW_ELEVATION;
  const cameraDir = horiz
    .clone()
    .multiplyScalar(Math.cos(VIEW_AZIMUTH))
    .addScaledVector(right, Math.sin(VIEW_AZIMUTH)) // swing toward the right, away from the photo
    .multiplyScalar(Math.cos(el))
    .add(new THREE.Vector3(0, Math.sin(el), 0))
    .normalize();

  // The model turns in quarter steps while the photo stays put, so leave room for either orientation.
  const half = Math.max(size.x, size.z) / 2;
  let minR = -half;
  let photo: Layout['photo'] = null;
  if (photoAspect) {
    const height = size.y;
    const maxWidth = Math.max(size.x, size.z) * 1.5;
    const width = Math.min(height * photoAspect, maxWidth);
    const gap = Math.max(1.5, half * 0.22);
    const offset = half + gap + width / 2;
    photo = {
      position: right.clone().multiplyScalar(-offset), // to the photo camera's left
      rotationY: Math.atan2(horiz.x, horiz.z), // faces the photo camera
      height,
      maxWidth,
    };
    minR = -(offset + width / 2);
  }
  const centerR = (minR + half) / 2;
  const target = right.clone().multiplyScalar(centerR).setY(size.y * 0.45);
  const width = half - minR;
  const depth = half * 2;
  return {
    target,
    cameraDir,
    width,
    height: size.y,
    depth,
    photo,
    key: [width, size.y, depth, centerR].map((n) => n.toFixed(2)).join('|') + '|' + cameraDir.toArray().map((n) => n.toFixed(3)).join(','),
  };
}

/** Distance at which the layout's slab fits the viewport when seen from its default camera direction. */
function fitDistance(l: Layout, aspect: number): number {
  const el = Math.asin(l.cameraDir.y);
  const seenW = l.width * Math.cos(VIEW_AZIMUTH) + l.depth * Math.sin(VIEW_AZIMUTH);
  const seenH = l.height * Math.cos(el) + l.depth * Math.sin(el);
  const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  return Math.max(seenH / 2 / t, seenW / 2 / (t * aspect)) * 1.18 + l.depth / 2;
}

/** Rotates its children around Y in quarter turns, easing toward the target angle. */
function Turntable({ turn, children }: { turn: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const target = (turn * Math.PI) / 2;

  useEffect(() => {
    invalidate();
  }, [target, invalidate]);

  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;
    const diff = target - g.rotation.y;
    if (Math.abs(diff) < 0.001) {
      g.rotation.y = target;
      return;
    }
    g.rotation.y += diff * (1 - Math.exp(-Math.min(delta, 1 / 30) * 9));
    invalidate();
  });

  return <group ref={ref}>{children}</group>;
}

function useImageTexture(url: string | null): { tex: THREE.Texture; aspect: number } | null {
  const [loaded, setLoaded] = useState<{ url: string; tex: THREE.Texture; aspect: number } | null>(null);
  useEffect(() => {
    if (!url) return;
    let dead = false;
    let tex: THREE.Texture | null = null;
    new THREE.TextureLoader().load(
      url,
      (t) => {
        if (dead) return t.dispose();
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        tex = t;
        const img = t.image as { width: number; height: number };
        setLoaded({ url, tex: t, aspect: img.width / Math.max(1, img.height) });
      },
      undefined,
      () => {
        if (!dead) setLoaded(null);
      },
    );
    return () => {
      dead = true;
      tex?.dispose();
    };
  }, [url]);
  return url && loaded && loaded.url === url ? loaded : null;
}

/** The source photo (in a thin frame) or its cutout, standing upright on the ground. */
function PhotoPrint({
  tex,
  aspect,
  height,
  maxWidth,
  framed,
  position,
  rotationY,
}: {
  tex: THREE.Texture;
  aspect: number;
  height: number;
  maxWidth: number;
  framed: boolean;
  position: THREE.Vector3;
  rotationY: number;
}) {
  const width = Math.min(height * aspect, maxWidth);
  const h = width / aspect;
  const border = Math.max(0.3, h * 0.03);
  const depth = Math.max(0.3, h * 0.025);
  return (
    <group position={position} rotation-y={rotationY}>
      {framed ? (
        <group position-y={(h + border * 2) / 2}>
          <RoundedBox args={[width + border * 2, h + border * 2, depth]} radius={Math.min(0.12, depth / 2.2)} smoothness={3} castShadow receiveShadow>
            <meshStandardMaterial color="#f8f4ea" roughness={0.75} />
          </RoundedBox>
          <mesh position-z={depth / 2 + Math.max(0.02, depth * 0.08)}>
            <planeGeometry args={[width, h]} />
            <meshBasicMaterial map={tex} toneMapped={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
          </mesh>
        </group>
      ) : (
        <mesh position-y={h / 2} position-z={0.01}>
          <planeGeometry args={[width, h]} />
          <meshBasicMaterial map={tex} toneMapped={false} transparent alphaTest={0.02} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
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
        shadow-mapSize={[3072, 3072]}
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

/**
 * Eases the camera to a goal pose. A layout/aspect change or `recenter` re-frames from the current
 * direction; `viewTick` also swings the camera round to the default 3/4 view of the photo's side.
 * The very first framing snaps.
 */
function CameraRig({ layout, recenter, viewTick }: { layout: Layout; recenter: number; viewTick: number }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const aspectRaw = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const aspect = Math.round(aspectRaw * 20) / 20;
  const invalidate = useThree((s) => s.invalidate);
  const goal = useRef<{ target: THREE.Vector3; dist: number; dir: THREE.Vector3 | null } | null>(null);
  const first = useRef(true);
  const seenTick = useRef(viewTick);
  const frame = useRef({ layout, aspect });
  frame.current = { layout, aspect };

  useEffect(() => {
    if (!controls) return;
    const { layout: l, aspect: a } = frame.current;
    const dist = fitDistance(l, a);
    if (first.current) {
      first.current = false; // snap on first framing
      controls.target.copy(l.target);
      camera.position.copy(l.target).addScaledVector(l.cameraDir, dist);
      controls.update();
      goal.current = null;
    } else {
      goal.current = { target: l.target.clone(), dist, dir: goal.current?.dir ?? null };
    }
    invalidate();
  }, [layout.key, aspect, recenter, controls, camera, invalidate]);

  useEffect(() => {
    if (!controls || seenTick.current === viewTick) return;
    seenTick.current = viewTick;
    const { layout: l, aspect: a } = frame.current;
    goal.current = { target: l.target.clone(), dist: fitDistance(l, a), dir: l.cameraDir.clone() };
    invalidate();
  }, [viewTick, controls, invalidate]);

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
    let turning = false;
    if (g.dir) {
      const q = new THREE.Quaternion().setFromUnitVectors(dir, g.dir);
      dir.applyQuaternion(new THREE.Quaternion().slerp(q, k));
      turning = dir.angleTo(g.dir) > 0.003;
    }
    controls.target.lerp(g.target, k);
    const next = cur + (g.dist - cur) * k;
    camera.position.copy(controls.target).addScaledVector(dir, next);
    controls.update();
    if (!turning && controls.target.distanceTo(g.target) < 0.01 && Math.abs(next - g.dist) < 0.02) goal.current = null;
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
