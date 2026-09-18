import { Canvas, useFrame } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { Vector3 } from 'three';
import { DRIVERS_2026 } from '../domain/grid-2026';
import { useRaceStore } from '../store/race-store';
import { CarField } from './CarField';
import { Environment } from './Environment';
import { RaceEffects } from './RaceEffects';
import { RaceCameras } from '../cameras/RaceCameras';

export type SceneQualityTier = 'high' | 'mobile';
export type SceneQualityOverride = SceneQualityTier | 'auto';

export interface QualitySignals {
  viewportWidth: number;
  coarsePointer: boolean;
  override?: SceneQualityTier;
}

export interface SceneQuality {
  tier: SceneQualityTier;
  dpr: number | [number, number];
}

export function selectQualityTier(signals: QualitySignals): SceneQuality {
  const tier = signals.override
    ?? (signals.viewportWidth < 900 || signals.coarsePointer ? 'mobile' : 'high');
  // Cap DPR: mobile/auto=1 for perf, high=1.5 max
  return tier === 'mobile' ? { tier, dpr: 1 } : { tier, dpr: [1, 1.5] };
}

export function createWebGLCapabilityDetector(probe: () => boolean): () => boolean {
  let cached: boolean | undefined;
  return () => {
    if (cached === undefined) cached = probe();
    return cached;
  };
}

function probeWebGLCapability(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (navigator.userAgent.toLowerCase().includes('jsdom')) return false;

  const canvas = document.createElement('canvas');
  let context: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    return context !== null;
  } catch {
    return false;
  } finally {
    const loseContext = context?.getExtension('WEBGL_lose_context') as { loseContext?(): void } | null | undefined;
    loseContext?.loseContext?.();
    canvas.width = 0;
    canvas.height = 0;
  }
}

const detectWebGLCapability = createWebGLCapabilityDetector(probeWebGLCapability);

export interface SceneStatusInput {
  webGLAvailable: boolean;
  renderFailed: boolean;
  rendererCreated: boolean;
  assetsActive: boolean;
  assetsLoaded: number;
  assetsTotal: number;
  assetErrors: readonly string[];
}

export function isRaceSceneReady(input: SceneStatusInput): boolean {
  return input.webGLAvailable
    && !input.renderFailed
    && input.rendererCreated
    && !input.assetsActive
    && input.assetsTotal > 0
    && input.assetsLoaded >= input.assetsTotal
    && input.assetErrors.length === 0;
}

function assetName(path: string): string {
  const cleanPath = path.split(/[?#]/, 1)[0];
  return cleanPath.slice(cleanPath.lastIndexOf('/') + 1) || 'scene asset';
}

export function getRaceSceneStatus(input: SceneStatusInput): string {
  if (!input.webGLAvailable) return 'Preparing the grid · accessible race view';
  if (input.renderFailed) return '3D renderer unavailable · accessible race view';
  if (input.assetErrors.length > 0 && !input.assetsActive) {
    return `Asset load failed · ${assetName(input.assetErrors[0])} · procedural fallback`;
  }
  if (
    !input.rendererCreated
    || input.assetsActive
    || input.assetsTotal === 0
    || input.assetsLoaded < input.assetsTotal
  ) return 'Rendering Shanghai race scene';
  return isRaceSceneReady(input) ? 'Ready · 14 cars on the Shanghai circuit' : 'Rendering Shanghai race scene';
}

export class SceneRenderBoundary extends Component<{
  children: ReactNode;
  fallback: ReactNode;
  onError?(): void;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { this.props.onError?.(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function SimulationClock() {
  const tick = useRaceStore((state) => state.tick);
  useFrame((_, delta) => tick(Math.min(delta, 0.1)));
  return null;
}

export function RaceScene() {
  const [webGLAvailable] = useState(detectWebGLCapability);
  const [rendererCreated, setRendererCreated] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);
  const { active: assetsActive, loaded: assetsLoaded, total: assetsTotal, errors: assetErrors } = useProgress();
  // Re-measure on resize. Detecting once at first render latched the tier to
  // whatever the window happened to be during mount, so a desktop window that
  // started narrow stayed on the mobile tier — and never loaded the real cars.
  const [viewportWidth, setViewportWidth] = useState(
    () => (typeof window === 'undefined' ? 1280 : window.innerWidth),
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const measure = () => setViewportWidth(window.innerWidth);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const coarsePointer = typeof window !== 'undefined'
    && window.matchMedia?.('(pointer: coarse)').matches === true;
  const qualityMode = useRaceStore((state) => state.qualityMode);
  const selectedDriverId = useRaceStore((state) => state.selectedDriverId);
  const selectDriver = useRaceStore((state) => state.selectDriver);
  const raceFlag = useRaceStore((state) => state.snapshot.flag);
  const quality = selectQualityTier({
    viewportWidth,
    coarsePointer,
    override: qualityMode === 'auto' ? undefined : qualityMode,
  });
  const sceneStatus = getRaceSceneStatus({
    webGLAvailable,
    renderFailed,
    rendererCreated,
    assetsActive,
    assetsLoaded,
    assetsTotal,
    assetErrors,
  });

  return (
    <section className="race-viewport" data-flag={raceFlag} aria-label="3D race viewport">
      <p className="race-viewport__status" role="status" aria-live="polite">
        {webGLAvailable ? sceneStatus : <><span>Preparing the grid</span> · accessible race view</>}
      </p>
      {webGLAvailable ? (
        <SceneRenderBoundary
          fallback={<div className="race-viewport__fallback" aria-hidden="true" />}
          onError={() => setRenderFailed(true)}
        >
          <Canvas
            className="race-canvas"
            aria-hidden="true"
            fallback={<div className="race-viewport__fallback" aria-hidden="true" />}
            dpr={quality.dpr}
            shadows={quality.tier === 'high'}
            camera={{ position: [-260, 150, 520], fov: 38, near: 0.5, far: 9000 }}
            gl={{
              antialias: quality.tier === 'high',
              alpha: false,
              powerPreference: quality.tier === 'high' ? 'high-performance' : 'low-power',
            }}
            onCreated={({ camera }) => {
              camera.lookAt(new Vector3(-8, 3, -18));
              setRendererCreated(true);
            }}
            onPointerMissed={() => selectDriver(null)}
          >
            <Environment quality={quality.tier} />
            <CarField quality={quality.tier} />
            <RaceEffects />
            <RaceCameras />
            <SimulationClock />
          </Canvas>
        </SceneRenderBoundary>
      ) : <div className="race-viewport__fallback" aria-hidden="true" />}
      <div className="visually-hidden" aria-label={`${quality.tier} scene controls`}>
        {DRIVERS_2026.map((driver) => (
          <button
            key={driver.id}
            type="button"
            data-driver-id={driver.id}
            aria-label={`Select ${driver.name} car`}
            aria-pressed={selectedDriverId === driver.id}
            onClick={() => selectDriver(driver.id)}
          >
            {driver.abbreviation} car {driver.number}
          </button>
        ))}
      </div>
    </section>
  );
}
