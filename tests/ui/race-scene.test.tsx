import { fireEvent, render, screen } from '@testing-library/react';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import { App } from '../../src/app/App';
import { getCarTrackSample, shouldPresentCar } from '../../src/scene/CarField';
import { selectQualityTier } from '../../src/scene/RaceScene';
import { EFFECT_POOL_CAPACITY } from '../../src/scene/RaceEffects';
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
  expect(getCarTrackSample({ ...baseCar, pitState: 'stopped', targetLine: 'pit' })).toEqual({
    distance: 0.5,
    lateral: 0,
    line: 'pit',
  });
  expect(getCarTrackSample(baseCar).line).toBe('attack');

  const retired = { ...baseCar, status: 'retired' as const, speed: 0, retirementTick: 500 };
  expect(shouldPresentCar(retired, 579)).toBe(true);
  expect(shouldPresentCar(retired, 581)).toBe(false);
});

it('keeps lightweight incident pools bounded', () => {
  expect(EFFECT_POOL_CAPACITY).toEqual({ smoke: 32, sparks: 64, debris: 24 });
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

it('exposes all 22 cars as driver-selectable controls without WebGL', () => {
  render(<App />);

  const driverControls = screen.getAllByRole('button', { name: /select .* car/i });
  expect(driverControls).toHaveLength(DRIVERS_2026.length);
  expect(driverControls).toHaveLength(22);
  expect(driverControls[0]).toHaveAttribute('data-driver-id', DRIVERS_2026[0].id);

  fireEvent.click(driverControls[0]);
  expect(driverControls[0]).toHaveAttribute('aria-pressed', 'true');
});
