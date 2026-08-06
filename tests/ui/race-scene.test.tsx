import { fireEvent, render, screen } from '@testing-library/react';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { vi } from 'vitest';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import type { ReactNode } from 'react';
import { App } from '../../src/app/App';
import { getCarTrackSample, shouldPresentCar, shouldShowCarLabel } from '../../src/scene/CarField';
import {
  createWebGLCapabilityDetector,
  getRaceSceneStatus,
  isRaceSceneReady,
  SceneRenderBoundary,
  selectQualityTier,
} from '../../src/scene/RaceScene';
import { EFFECT_POOL_CAPACITY } from '../../src/scene/RaceEffects';
import { cloneSceneWithOwnedMaterials } from '../../src/scene/scene-resources';
import type { CarState } from '../../src/simulation/events';
import {
  calculateCameraPose,
  calculateOverheadCameraPose,
  calculateTrackBounds,
  cameraBlendFactor,
  createCameraTrackSampleCache,
  measureProjectedBox,
  sampleCameraTrackInto,
} from '../../src/cameras/RaceCameras';

it('exposes an accessible race viewport and loading status', () => {
  window.location.hash = '#/race';
  render(<App />);

  expect(screen.getByRole('region', { name: '3D race viewport' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent(/preparing|loading|ready/i);
});

const baseCar: CarState = {
  driverId: 'norris', lap: 12, distance: 0.94, lateralOffset: 0.2, speed: 0.003,
  tire: { compound: 'medium', wear: 0.2, temperature: 0.8 }, fuelFactor: 0.8,
  damage: 0, pitState: 'track', pitProgress: 0, position: 1, timing: { lastLap: 75, bestLap: 74, totalTime: 900 },
  targetLine: 'attack', status: 'running',
};

it('routes pit cars to the pit spline and retires cars after an incident grace period', () => {
  const pitCars = [
    { ...baseCar, distance: 0.94, pitProgress: 0.05, pitState: 'entry' as const, targetLine: 'pit' as const },
    { ...baseCar, distance: 0.94, pitProgress: 0.2, pitState: 'lane' as const, targetLine: 'pit' as const },
    { ...baseCar, distance: 0.94, pitProgress: 0.48, pitState: 'stopped' as const, targetLine: 'pit' as const },
    { ...baseCar, distance: 0.94, pitProgress: 0.7, pitState: 'stopped' as const, targetLine: 'pit' as const },
    { ...baseCar, distance: 0.94, pitProgress: 0.9, pitState: 'exit' as const, targetLine: 'pit' as const },
  ];
  const pitProgress = pitCars.map((car) => car.pitProgress);
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

it('disposes cloned materials but leaves attachment to the renderer', () => {
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

  // Disposal must NOT detach the object. `<primitive>` owns attachment, and
  // React StrictMode runs effects mount -> cleanup -> mount; detaching here
  // orphaned the model after the second mount so it never rendered.
  expect(resources.scene.parent).toBe(parent);
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
    assetsActive: false, assetsLoaded: 0, assetsTotal: 0, assetErrors: [],
  })).toMatch(/rendering|loading/i);
  expect(getRaceSceneStatus({
    webGLAvailable: true, renderFailed: false, rendererCreated: true,
    assetsActive: false, assetsLoaded: 13, assetsTotal: 13, assetErrors: [],
  })).toMatch(/^ready/i);

  const failed = {
    webGLAvailable: true, renderFailed: false, rendererCreated: true,
    assetsActive: false, assetsLoaded: 12, assetsTotal: 13,
    assetErrors: ['/assets/models/f1-car.glb'],
  };
  expect(isRaceSceneReady(failed)).toBe(false);
  expect(getRaceSceneStatus(failed)).toBe('Asset load failed · f1-car.glb · procedural fallback');
  expect(isRaceSceneReady({
    ...failed, assetsLoaded: 13, assetErrors: [],
  })).toBe(true);
});

it('shows car labels only for the selected driver or a close on-track battle', () => {
  const leader = { ...baseCar, driverId: 'norris', lap: 4, distance: 0.52, position: 1 };
  const closeFollower = { ...baseCar, driverId: 'leclerc', lap: 4, distance: 0.511, position: 2 };
  const distantCar = { ...baseCar, driverId: 'hamilton', lap: 4, distance: 0.43, position: 3 };
  const cars = [leader, closeFollower, distantCar];

  expect(shouldShowCarLabel(distantCar, cars, 'hamilton')).toBe(true);
  expect(shouldShowCarLabel(leader, cars, null)).toBe(true);
  expect(shouldShowCarLabel(closeFollower, cars, null)).toBe(true);
  expect(shouldShowCarLabel(distantCar, cars, null)).toBe(false);
  expect(shouldShowCarLabel({ ...closeFollower, pitState: 'lane' }, cars, null)).toBe(false);
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

it('exposes all 14 cars as driver-selectable controls without WebGL', () => {
  window.location.hash = '#/race';
  render(<App />);

  const driverControls = screen.getAllByRole('button', { name: /select .* car/i });
  expect(driverControls).toHaveLength(DRIVERS_2026.length);
  expect(driverControls).toHaveLength(14);
  expect(driverControls[0]).toHaveAttribute('data-driver-id', DRIVERS_2026[0].id);

  fireEvent.click(driverControls[0]);
  expect(driverControls[0]).toHaveAttribute('aria-pressed', 'true');
});

it('calculates distinct allocation-safe poses for broadcast, chase, cockpit, and overhead cameras', () => {
  const transform = {
    position: new Vector3(4, 2, 7),
    tangent: new Vector3(0, 0, 1),
    rotation: new Quaternion(),
  };
  const anchor = {
    id: 'camera-test',
    name: 'Camera Test',
    distance: 0.5,
    position: { x: 20, y: 12, z: 30 },
    targetOffset: { x: 0, y: 0.5, z: 0 },
  };

  const broadcast = calculateCameraPose('broadcast', transform, anchor);
  const chase = calculateCameraPose('chase', transform, anchor);
  const cockpit = calculateCameraPose('cockpit', transform, anchor);
  const overhead = calculateCameraPose('overhead', transform, anchor);

  expect(broadcast!.position.distanceTo(transform.position)).toBeGreaterThanOrEqual(31);
  expect(broadcast!.position.distanceTo(transform.position)).toBeLessThanOrEqual(36);
  expect(broadcast!.position.z).toBeLessThan(transform.position.z);
  expect(Math.abs(broadcast!.position.x - transform.position.x)).toBeGreaterThanOrEqual(10);
  expect(broadcast!.position.y - transform.position.y).toBeGreaterThanOrEqual(20);
  expect(broadcast!.target.z).toBeGreaterThan(transform.position.z);
  expect(broadcast!.fov).toBe(44);
  expect(chase!.position.y).toBeGreaterThan(transform.position.y);
  expect(chase!.position.z).toBeLessThan(transform.position.z);
  expect(chase!.target.z).toBeGreaterThan(transform.position.z);
  expect(cockpit!.position.distanceTo(transform.position)).toBeLessThan(chase!.position.distanceTo(transform.position));
  expect(cockpit!.target.z).toBeGreaterThan(transform.position.z);
  expect(overhead!.position.y).toBeGreaterThan(100);
  expect(calculateCameraPose('free', transform, anchor)).toBeNull();
});

it('measures projected target bounds for browser framing diagnostics', () => {
  const camera = new PerspectiveCamera(40, 16 / 9, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const measurement = measureProjectedBox(
    new Box3(new Vector3(-1, -0.5, -2), new Vector3(1, 0.5, 2)),
    camera,
  );

  expect(measurement.inFrustum).toBe(true);
  expect(measurement.centerX).toBeCloseTo(0, 5);
  expect(measurement.centerY).toBeCloseTo(0, 5);
  expect(measurement.height).toBeGreaterThan(0.1);
  expect(measurement.height).toBeLessThan(0.3);
});

it('snaps broadcast cuts while keeping chase and cockpit camera movement damped', () => {
  expect(cameraBlendFactor('broadcast', false, 1 / 60, true)).toBe(1);
  expect(cameraBlendFactor('broadcast', false, 1 / 60, false)).toBe(1);
  expect(cameraBlendFactor('chase', false, 1 / 60, true)).toBeLessThan(1);
  expect(cameraBlendFactor('cockpit', true, 1 / 60, true)).toBeLessThan(1);
});

it('fits complete track bounds with margin in landscape and portrait overhead views', () => {
  const bounds = calculateTrackBounds([
    { x: -50, y: -2, z: -20 },
    { x: 70, y: 20, z: 80 },
    { x: 10, y: 4, z: 40 },
  ]);
  expect(bounds).toEqual({ minX: -50, maxX: 70, minY: -2, maxY: 20, minZ: -20, maxZ: 80 });

  for (const aspect of [16 / 9, 9 / 16]) {
    const fov = 42;
    const margin = 1.12;
    const pose = calculateOverheadCameraPose(bounds, aspect, fov, margin);
    const verticalHalfAngle = (fov * Math.PI) / 360;
    const horizontalHalfAngle = Math.atan(Math.tan(verticalHalfAngle) * aspect);
    const clearance = pose.position.y - bounds.maxY;
    expect(clearance).toBeGreaterThanOrEqual(((bounds.maxZ - bounds.minZ) / 2 / Math.tan(verticalHalfAngle)) * margin);
    expect(clearance).toBeGreaterThanOrEqual(((bounds.maxX - bounds.minX) / 2 / Math.tan(horizontalHalfAngle)) * margin);
    expect(pose.target.x).toBe(10);
    expect(pose.target.z).toBe(30);
  }
});

it('serves changing car positions from an immutable spline cache without resampling', () => {
  const transform = {
    position: new Vector3(4, 2, 7),
    tangent: new Vector3(0, 0, 1),
    rotation: new Quaternion(),
  };
  const sample = vi.fn(() => transform);
  const cache = createCameraTrackSampleCache({ sample }, 8);
  const callsAfterWarmup = sample.mock.calls.length;
  const output = { x: 0, y: 0, z: 0, tangentX: 0, tangentY: 0, tangentZ: 0 };

  for (let index = 0; index < 100; index += 1) {
    expect(sampleCameraTrackInto(cache, index / 100, 0.2, 'center', output)).toBe(output);
  }

  expect(sample).toHaveBeenCalledTimes(callsAfterWarmup);
  expect(output).toMatchObject({ x: 3.8, y: 2, z: 7, tangentX: 0, tangentY: 0, tangentZ: 1 });
});
