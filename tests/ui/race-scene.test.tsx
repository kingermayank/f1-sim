import { fireEvent, render, screen } from '@testing-library/react';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { vi } from 'vitest';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import type { ReactNode } from 'react';
import { App } from '../../src/app/App';
import { getCarTrackSample, getPitSplineProgress, shouldPresentCar } from '../../src/scene/CarField';
import {
  createWebGLCapabilityDetector,
  getRaceSceneStatus,
  SceneRenderBoundary,
  selectQualityTier,
} from '../../src/scene/RaceScene';
import { EFFECT_POOL_CAPACITY } from '../../src/scene/RaceEffects';
import { cloneSceneWithOwnedMaterials } from '../../src/scene/scene-resources';
import type { CarState } from '../../src/simulation/events';

it('exposes an accessible race viewport and loading status', () => {
  render(<App />);

  expect(screen.getByRole('region', { name: '3D race viewport' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent(/preparing|loading|ready/i);
});

const baseCar: CarState = {
  driverId: 'norris', lap: 12, distance: 0.94, lateralOffset: 0.2, speed: 0.003,
  tire: { compound: 'medium', wear: 0.2, temperature: 0.8 }, fuelFactor: 0.8,
  damage: 0, pitState: 'track', position: 1, timing: { lastLap: 75, bestLap: 74, totalTime: 900 },
  targetLine: 'attack', status: 'running',
};

it('routes pit cars to the pit spline and retires cars after an incident grace period', () => {
  const pitCars = [
    { ...baseCar, distance: 0.915, pitState: 'entry' as const, targetLine: 'pit' as const },
    { ...baseCar, distance: 0.94, pitState: 'entry' as const, targetLine: 'pit' as const },
    { ...baseCar, distance: 0.98, pitState: 'lane' as const, targetLine: 'pit' as const },
    { ...baseCar, distance: 0.01, pitState: 'stopped' as const, targetLine: 'pit' as const },
    { ...baseCar, distance: 0.06, pitState: 'exit' as const, targetLine: 'pit' as const },
  ];
  const pitProgress = pitCars.map(getPitSplineProgress);
  expect(new Set(pitProgress).size).toBe(pitCars.length);
  expect(pitProgress).toEqual([...pitProgress].sort((a, b) => a - b));
  expect(pitCars.map((car) => getCarTrackSample(car).distance)).toEqual(pitProgress);
  expect(pitCars.every((car) => getCarTrackSample(car).line === 'pit')).toBe(true);
  expect(getCarTrackSample(baseCar).line).toBe('attack');

  const retired = { ...baseCar, status: 'retired' as const, speed: 0, retirementTick: 500 };
  expect(shouldPresentCar(retired, 579)).toBe(true);
  expect(shouldPresentCar(retired, 581)).toBe(false);
});

it('keeps lightweight incident pools bounded', () => {
  expect(EFFECT_POOL_CAPACITY).toEqual({ smoke: 32, sparks: 64, debris: 24 });
});

it('disposes cloned materials without disposing shared asset geometry or source materials', () => {
  const geometry = new BoxGeometry();
  const sourceMaterial = new MeshStandardMaterial();
  const source = new Group();
  source.add(new Mesh(geometry, sourceMaterial));
  const geometryDispose = vi.spyOn(geometry, 'dispose');
  const sourceMaterialDispose = vi.spyOn(sourceMaterial, 'dispose');

  const resources = cloneSceneWithOwnedMaterials(source);
  const clonedMesh = resources.scene.children[0] as Mesh;
  const clonedMaterial = clonedMesh.material as MeshStandardMaterial;
  const clonedMaterialDispose = vi.spyOn(clonedMaterial, 'dispose');
  const parent = new Group();
  parent.add(resources.scene);

  resources.dispose();

  expect(resources.scene.parent).toBeNull();
  expect(clonedMaterialDispose).toHaveBeenCalledOnce();
  expect(sourceMaterialDispose).not.toHaveBeenCalled();
  expect(geometryDispose).not.toHaveBeenCalled();
});

it('uses a capped mobile quality tier and honors a user override', () => {
  expect(selectQualityTier({ viewportWidth: 700, coarsePointer: false })).toEqual({
    dpr: 1,
    tier: 'mobile',
  });
  expect(selectQualityTier({ viewportWidth: 1600, coarsePointer: false, override: 'mobile' })).toEqual({
    dpr: 1,
    tier: 'mobile',
  });
  expect(selectQualityTier({ viewportWidth: 1600, coarsePointer: false, override: 'high' })).toEqual({
    dpr: [1, 1.5],
    tier: 'high',
  });
});

it('probes WebGL capability once and keeps loading status truthful until assets settle', () => {
  const probe = vi.fn(() => true);
  const detect = createWebGLCapabilityDetector(probe);
  expect(detect()).toBe(true);
  expect(detect()).toBe(true);
  expect(probe).toHaveBeenCalledOnce();

  expect(getRaceSceneStatus({
    webGLAvailable: true, renderFailed: false, rendererCreated: true,
    assetsActive: false, assetsLoaded: 0, assetsTotal: 0, assetErrors: 0,
  })).toMatch(/rendering|loading/i);
  expect(getRaceSceneStatus({
    webGLAvailable: true, renderFailed: false, rendererCreated: true,
    assetsActive: false, assetsLoaded: 13, assetsTotal: 13, assetErrors: 0,
  })).toMatch(/^ready/i);
});

it('replaces render-tree crashes with the accessible procedural fallback', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  function BrokenScene(): ReactNode { throw new Error('renderer failed'); }
  render(
    <SceneRenderBoundary fallback={<div data-testid="scene-fallback" />}>
      <BrokenScene />
    </SceneRenderBoundary>,
  );
  expect(screen.getByTestId('scene-fallback')).toBeVisible();
  consoleError.mockRestore();
});

it('exposes all 22 cars as driver-selectable controls without WebGL', () => {
  render(<App />);

  const driverControls = screen.getAllByRole('button', { name: /select .* car/i });
  expect(driverControls).toHaveLength(DRIVERS_2026.length);
  expect(driverControls).toHaveLength(22);
  expect(driverControls[0]).toHaveAttribute('data-driver-id', DRIVERS_2026[0].id);

  fireEvent.click(driverControls[0]);
  expect(driverControls[0]).toHaveAttribute('aria-pressed', 'true');
});
