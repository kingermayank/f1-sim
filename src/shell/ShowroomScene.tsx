import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { NeutralToneMapping, PerspectiveCamera, Vector2, Vector3, type Group } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { F1Car } from '../car/F1Car';
import type { Livery } from '../car/liveries';
import type { COMPOUNDS } from '../car/car-materials';
import { PostFX, type PostFXHandle } from './showroom/PostFX';
import { ShowroomStage, Turntable } from './showroom/ShowroomStage';

export type PictureAngle = 'front' | 'side' | 'rear' | 'above';

/** Renders a clean picture of the car from one of the fixed angles. */
export type ShowroomCapture = (angle: PictureAngle, width?: number, height?: number) => HTMLCanvasElement | null;

interface CameraPreset { yaw: number; pitch: number; distance: number; fov: number; target: [number, number, number] }

/** Yaw is measured from the car's nose (+Z) round towards its left (+X). */
const PRESETS: Record<PictureAngle, CameraPreset> = {
  front: { yaw: 0.78, pitch: 0.12, distance: 8.1, fov: 28, target: [0.1, 0.48, 0.15] },
  side: { yaw: Math.PI / 2, pitch: 0.04, distance: 9.2, fov: 26, target: [0, 0.45, 0] },
  rear: { yaw: Math.PI - 0.78, pitch: 0.14, distance: 8, fov: 28, target: [0, 0.5, -0.1] },
  above: { yaw: 0.6, pitch: 0.62, distance: 8.6, fov: 28, target: [0, 0.4, 0] },
};

const HERO = PRESETS.front;
/** The room is 13 m in radius; the camera stays well inside it. */
const MAX_DISTANCE = 11.2;

function presetPosition(preset: CameraPreset, distanceScale = 1, out = new Vector3()): Vector3 {
  const d = preset.distance * distanceScale;
  return out.set(
    preset.target[0] + Math.sin(preset.yaw) * Math.cos(preset.pitch) * d,
    preset.target[1] + Math.sin(preset.pitch) * d,
    preset.target[2] + Math.cos(preset.yaw) * Math.cos(preset.pitch) * d,
  );
}

export interface FrameInset {
  /** Pixels covered on the right by the card (desktop). */
  right: number;
  /** Pixels covered at the bottom by the sheet (phone). */
  bottom: number;
  /** Pixels covered at the top by the driver block (phone). */
  top: number;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Keeps the car in the part of the screen the UI does not cover: the
 * projection is shifted away from the card, and the camera backs off on
 * narrow or portrait screens so the whole car stays in frame. It also flies
 * in from further out when the room first appears.
 */
function CameraRig({ inset, controls }: { inset: FrameInset; controls: MutableRefObject<OrbitControlsImpl | null> }) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const size = useThree((state) => state.size);
  const intro = useRef(0);
  const from = useMemo(() => new Vector3(), []);
  const to = useMemo(() => new Vector3(), []);

  const fit = useMemo(() => {
    const freeWidth = Math.max(160, size.width - inset.right);
    const freeHeight = Math.max(160, size.height - inset.bottom - inset.top);
    // The projection spans the whole canvas; the free area sees only its
    // share of it. The car seen three-quarter on fills about 5.7 m x 2.4 m.
    const neededAt = (fov: number) => {
      const halfTan = Math.tan((fov * Math.PI) / 360);
      return Math.max(2.85 / (halfTan * (freeWidth / size.height)), 1.2 / (halfTan * (freeHeight / size.height)));
    };
    // Back off to fit, but never through the wall: past that, widen the lens.
    let fov = HERO.fov + (size.width < 900 ? 4 : 0);
    while (neededAt(fov) > MAX_DISTANCE && fov < 64) fov += 2;
    return { fov, scale: Math.max(1, Math.min(MAX_DISTANCE / HERO.distance, neededAt(fov) / HERO.distance)) };
  }, [size.width, size.height, inset.right, inset.bottom, inset.top]);

  useEffect(() => {
    camera.fov = fit.fov;
    // Shift the picture so the car sits in the middle of what the UI leaves free.
    const lift = size.width >= 900 ? size.height * 0.02 : 0;
    camera.setViewOffset(size.width, size.height, inset.right * 0.5, (inset.bottom - inset.top) * 0.5 + lift, size.width, size.height);
    camera.updateProjectionMatrix();
    const orbit = controls.current;
    if (orbit) {
      orbit.minDistance = HERO.distance * fit.scale * 0.62;
      orbit.maxDistance = Math.min(MAX_DISTANCE + 0.6, HERO.distance * fit.scale * 1.45);
    }
  }, [camera, controls, fit, inset.bottom, inset.right, inset.top, size.height, size.width]);

  useEffect(() => {
    // First frame: start wide and high, then glide to the hero view.
    intro.current = 0;
    presetPosition({ ...HERO, yaw: HERO.yaw + 0.75, pitch: 0.34 }, Math.min(fit.scale * 1.5, (MAX_DISTANCE + 0.5) / HERO.distance), from);
    camera.position.copy(from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    if (intro.current >= 1) return;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    intro.current = reduced ? 1 : Math.min(1, intro.current + Math.min(delta, 0.05) / 2.2);
    presetPosition(HERO, fit.scale, to);
    camera.position.lerpVectors(from, to, easeInOutCubic(intro.current));
    controls.current?.target.set(...HERO.target);
    controls.current?.update();
  });

  return null;
}

/** Registers the picture renderer with the page. */
function Capture({ captureRef, composer, turntable, controls }: {
  captureRef?: MutableRefObject<ShowroomCapture | null>;
  composer: MutableRefObject<PostFXHandle | null>;
  turntable: MutableRefObject<Group | null>;
  controls: MutableRefObject<OrbitControlsImpl | null>;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera) as PerspectiveCamera;

  useEffect(() => {
    if (!captureRef) return;
    captureRef.current = (angle, width = 1920, height = 1080) => {
      const preset = PRESETS[angle];
      const pixelRatio = gl.getPixelRatio();
      const size = gl.getSize(new Vector2());
      const saved = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        fov: camera.fov,
        aspect: camera.aspect,
        view: camera.view ? { ...camera.view } : null,
        turn: turntable.current?.rotation.y ?? 0,
      };
      const post = composer.current?.composer;
      try {
        gl.setPixelRatio(1);
        gl.setSize(width, height, false);
        post?.setPixelRatio(1);
        post?.setSize(width, height);
        camera.clearViewOffset();
        camera.aspect = width / height;
        camera.fov = preset.fov;
        presetPosition(preset, 1, camera.position);
        camera.lookAt(new Vector3(...preset.target));
        camera.updateProjectionMatrix();
        if (turntable.current) turntable.current.rotation.y = 0;
        scene.updateMatrixWorld(true);
        if (post) post.render(0); else gl.render(scene, camera);
        const out = document.createElement('canvas');
        out.width = width;
        out.height = height;
        out.getContext('2d')!.drawImage(gl.domElement, 0, 0, width, height);
        return out;
      } catch {
        return null;
      } finally {
        gl.setPixelRatio(pixelRatio);
        gl.setSize(size.x, size.y, false);
        post?.setPixelRatio(pixelRatio);
        post?.setSize(size.x, size.y);
        camera.position.copy(saved.position);
        camera.quaternion.copy(saved.quaternion);
        camera.fov = saved.fov;
        camera.aspect = saved.aspect;
        if (saved.view) camera.setViewOffset(saved.view.fullWidth, saved.view.fullHeight, saved.view.offsetX, saved.view.offsetY, saved.view.width, saved.view.height);
        camera.updateProjectionMatrix();
        if (turntable.current) turntable.current.rotation.y = saved.turn;
        controls.current?.update();
        // Resizing cleared the canvas: draw the live view again before the page shows it.
        scene.updateMatrixWorld(true);
        if (post) post.render(0); else gl.render(scene, camera);
      }
    };
    return () => { captureRef.current = null; };
  }, [camera, captureRef, composer, controls, gl, scene, turntable]);
  return null;
}

/**
 * Quality steps, best first. The governor watches the frame rate and steps
 * down when frames run long: ambient occlusion goes first, then bloom and the
 * turntable reflection, then resolution. It never steps back up within a
 * visit, so it cannot oscillate.
 */
const QUALITY = [
  { ao: true, bloom: true, reflect: true, dpr: 1.5 },
  { ao: false, bloom: true, reflect: true, dpr: 1.5 },
  { ao: false, bloom: false, reflect: false, dpr: 1.25 },
  { ao: false, bloom: false, reflect: false, dpr: 1 },
] as const;

function Governor({ level, onDecline }: { level: number; onDecline(): void }) {
  const frames = useRef(0);
  const elapsed = useRef(0);
  const settle = useRef(0);
  useFrame((_, delta) => {
    // Skip the first second after a change: shaders compile, targets resize.
    if (settle.current < 1) { settle.current += delta; return; }
    frames.current += 1;
    elapsed.current += delta;
    if (frames.current >= 8 && elapsed.current >= 1.6) {
      const fps = frames.current / elapsed.current;
      frames.current = 0;
      elapsed.current = 0;
      if (fps < 42 && level < QUALITY.length - 1) { settle.current = 0; onDecline(); }
    }
  });
  return null;
}

export interface ShowroomSceneProps {
  livery: Livery;
  number: number;
  pod: 'first' | 'second';
  straight: boolean;
  compound: keyof typeof COMPOUNDS;
  spinning: boolean;
  lite?: boolean;
  inset: FrameInset;
  captureRef?: MutableRefObject<ShowroomCapture | null>;
}

export function ShowroomScene({ livery, number, pod, straight, compound, spinning, lite = false, inset, captureRef }: ShowroomSceneProps) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const composer = useRef<PostFXHandle | null>(null);
  const turntable = useRef<Group | null>(null);
  const onPost = useCallback((handle: PostFXHandle) => { composer.current = handle; }, []);
  const [level, setLevel] = useState(lite ? QUALITY.length - 1 : 0);
  const quality = QUALITY[level];
  const decline = useCallback(() => setLevel((value) => Math.min(QUALITY.length - 1, value + 1)), []);
  return (
    <Canvas
      className="showroom__canvas"
      shadows="percentage"
      dpr={lite ? [1, 1.5] : [1, quality.dpr]}
      gl={{ antialias: lite, powerPreference: 'high-performance', stencil: false }}
      camera={{ position: presetPosition(HERO, 1.7).toArray(), fov: HERO.fov, near: 0.06, far: 140 }}
      onCreated={({ gl }) => {
        gl.toneMapping = NeutralToneMapping;
        gl.toneMappingExposure = 1;
      }}
    >
      <ShowroomStage accent={livery.primary} />
      <Turntable accent={livery.primary} spinning={spinning} reflect={!lite && quality.reflect} groupRef={turntable}>
        <F1Car livery={livery} number={number} pod={pod} straight={straight} compound={compound} />
      </Turntable>
      <OrbitControls
        ref={controls}
        makeDefault
        target={HERO.target}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.55}
        zoomSpeed={0.6}
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI / 2 - 0.03}
      />
      <CameraRig inset={inset} controls={controls} />
      {!lite && <PostFX ao={quality.ao} bloom={quality.bloom} onReady={onPost} />}
      {!lite && <Governor level={level} onDecline={decline} />}
      <Capture captureRef={captureRef} composer={composer} turntable={turntable} controls={controls} />
    </Canvas>
  );
}
