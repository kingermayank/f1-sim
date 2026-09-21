import { describe, expect, it } from 'vitest';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import { createGameStore, projectedTrack } from '../../src/game/game-store';

const FULL_THROTTLE = { throttle: 1, brake: 0, steer: 0, drs: false };
const COAST = { throttle: 0, brake: 0, steer: 0, drs: false };

/** Drives the player along the racing line by steering toward it each step. */
function autopilot(store: ReturnType<typeof createGameStore>, seconds: number, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) {
    const { car, fraction } = store.getState();
    const ahead = projectedTrack.at(fraction + 0.004);
    const targetHeading = Math.atan2(ahead.point.z - car.z, ahead.point.x - car.x);
    let error = targetHeading - car.heading;
    while (error > Math.PI) error -= Math.PI * 2;
    while (error < -Math.PI) error += Math.PI * 2;
    // Lift for corners so the autopilot stays on the road.
    const throttle = Math.abs(error) > 0.25 ? 0 : 1;
    const brake = Math.abs(error) > 0.45 && car.speed > 35 ? 1 : 0;
    store.getState().step(dt, { throttle, brake, steer: Math.max(-1, Math.min(1, error * 4)), drs: true });
    if (store.getState().phase === 'finished') return;
  }
}

describe('game store', () => {
  it('starts on the grid, stopped, facing along the track', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 3, seed: 'grid' });
    const { car, fraction, onTrack, position, lap } = store.getState();
    expect(car.speed).toBe(0);
    expect(onTrack).toBe(true);
    // Same grid convention as the AI: lap -1 until the line, and last on the grid.
    expect(lap).toBe(-1);
    expect(position).toBe(DRIVERS_2026.length);
    // Back of the grid sits just before the line.
    expect(fraction).toBeGreaterThan(0.95);
  });

  it('holds the car during the countdown, then races', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 3, seed: 'countdown' });
    store.getState().start();
    expect(store.getState().phase).toBe('countdown');
    store.getState().step(1, FULL_THROTTLE);
    expect(store.getState().car.speed).toBe(0);
    store.getState().step(2.5, FULL_THROTTLE);
    expect(store.getState().phase).toBe('racing');
    store.getState().step(0.5, FULL_THROTTLE);
    expect(store.getState().car.speed).toBeGreaterThan(0);
  });

  it('runs the AI field without the player driver in it', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'verstappen', laps: 3, seed: 'field' });
    const ids = store.getState().ai.map((car) => car.driverId);
    expect(ids).toHaveLength(DRIVERS_2026.length - 1);
    expect(ids).not.toContain('verstappen');
  });

  it('counts laps as the player crosses the line and records lap times', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 3, difficulty: 'easy', seed: 'laps' });
    store.getState().start();
    store.getState().step(COUNTDOWN(), COAST);
    autopilot(store, 240);
    const { lap, lapTimes, bestLap } = store.getState();
    expect(lap).toBeGreaterThanOrEqual(1);
    expect(lapTimes.length).toBeGreaterThanOrEqual(1);
    expect(bestLap).not.toBeNull();
    for (const record of lapTimes) {
      expect(record.seconds).toBeGreaterThan(50);
      expect(record.seconds).toBeLessThan(200);
    }
  });

  it('finishes after the configured laps and reports a final position', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 2, difficulty: 'easy', seed: 'finish' });
    store.getState().start();
    store.getState().step(COUNTDOWN(), COAST);
    autopilot(store, 400);
    const state = store.getState();
    expect(state.phase).toBe('finished');
    expect(state.finishPosition).not.toBeNull();
    expect(state.finishPosition!).toBeGreaterThanOrEqual(1);
    expect(state.finishPosition!).toBeLessThanOrEqual(DRIVERS_2026.length);
    expect(state.lapTimes).toHaveLength(2);
  });

  it('resets the car onto the racing line after going off', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 3, seed: 'reset' });
    store.getState().start();
    store.getState().step(COUNTDOWN(), COAST);
    // Drive off the road sideways.
    for (let i = 0; i < 240; i += 1) store.getState().step(1 / 60, { throttle: 1, brake: 0, steer: 1, drs: false });
    store.getState().step(1 / 60, COAST);
    store.getState().resetToTrack();
    const { car, onTrack } = store.getState();
    expect(onTrack).toBe(true);
    expect(car.speed).toBe(0);
    expect(Math.abs(projectedTrack.project(car.x, car.z).lateral)).toBeLessThan(1);
  });
});

function COUNTDOWN() { return 3.05; }
