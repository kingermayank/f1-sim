import { Canvas, useFrame } from '@react-three/fiber';
import { useState } from 'react';
import { Vector3 } from 'three';
import { DRIVERS_2026 } from '../domain/grid-2026';
import { useRaceStore } from '../store/race-store';
import { CarField } from './CarField';
import { Environment } from './Environment';
import { RaceEffects } from './RaceEffects';

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
  return tier === 'mobile' ? { tier, dpr: 1 } : { tier, dpr: [1, 1.5] };
}

function canRenderWebGL(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (navigator.userAgent.toLowerCase().includes('jsdom')) return false;

  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function SimulationClock() {
  const tick = useRaceStore((state) => state.tick);
  useFrame((_, delta) => tick(Math.min(delta, 0.1)));
  return null;
}

export function RaceScene() {
  const webGLAvailable = canRenderWebGL();
  const [sceneReady, setSceneReady] = useState(false);
  const [detectedQuality] = useState<SceneQualityTier>(() => selectQualityTier({
    viewportWidth: typeof window === 'undefined' ? 1280 : window.innerWidth,
    coarsePointer: typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true,
  }).tier);
  const [qualityOverride, setQualityOverride] = useState<SceneQualityOverride>('auto');
  const selectedDriverId = useRaceStore((state) => state.selectedDriverId);
  const selectDriver = useRaceStore((state) => state.selectDriver);
  const quality = selectQualityTier({
    viewportWidth: typeof window === 'undefined' ? 1280 : window.innerWidth,
    coarsePointer: detectedQuality === 'mobile',
    override: qualityOverride === 'auto' ? detectedQuality : qualityOverride,
  });

  return (
    <section className="race-viewport" aria-label="3D race viewport">
      <p className="race-viewport__status" role="status" aria-live="polite">
        {webGLAvailable
          ? sceneReady ? 'Ready · 22 cars on the Monaco circuit' : 'Loading Monaco race scene'
          : <><span>Preparing the grid</span> · accessible race view</>}
      </p>
      {webGLAvailable ? (
        <Canvas
          className="race-canvas"
          aria-hidden="true"
          dpr={quality.dpr}
          shadows={quality.tier === 'high'}
          camera={{ position: [116, 88, 138], fov: 38, near: 0.2, far: 520 }}
          gl={{
            antialias: quality.tier === 'high',
            alpha: false,
            powerPreference: quality.tier === 'high' ? 'high-performance' : 'low-power',
          }}
          onCreated={({ camera }) => {
            camera.lookAt(new Vector3(-8, 3, -18));
            setSceneReady(true);
          }}
          onPointerMissed={() => selectDriver(null)}
        >
          <Environment quality={quality.tier} />
          <CarField quality={quality.tier} />
          <RaceEffects />
          <SimulationClock />
        </Canvas>
      ) : <div className="race-viewport__fallback" aria-hidden="true" />}
      <label className="race-quality">
        <span>Scene detail</span>
        <select
          aria-label="Scene detail"
          value={qualityOverride}
          onChange={(event) => setQualityOverride(event.target.value as SceneQualityOverride)}
        >
          <option value="auto">Auto ({detectedQuality})</option>
          <option value="high">High</option>
          <option value="mobile">Mobile</option>
        </select>
      </label>
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
