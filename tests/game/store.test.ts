import { describe, expect, it } from 'vitest';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import { INTRO_SECONDS, JUMP_START_PENALTY_SECONDS, createGameStore, projectedTrack } from '../../src/game/game-store';

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

  it('runs the intro, then the five lights, then races', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 3, seed: 'lights' });
    store.getState().start();
    expect(store.getState().phase).toBe('intro');
    store.getState().step(1, FULL_THROTTLE);
    expect(store.getState().car.speed).toBe(0);
    store.getState().step(INTRO_SECONDS, COAST);
    expect(store.getState().phase).toBe('lights');
    expect(store.getState().lights).toBe(0);
    for (let light = 1; light <= 5; light += 1) {
      store.getState().step(1.001, COAST);
      expect(store.getState().lights).toBe(light);
      expect(store.getState().phase).toBe('lights');
    }
    // A hold of unpredictable but bounded length, then lights out.
    store.getState().step(1.7, COAST);
    expect(store.getState().phase).toBe('racing');
    expect(store.getState().elapsed).toBe(0);
    expect(store.getState().jumpStart).toBe(false);
    store.getState().step(0.5, FULL_THROTTLE);
    expect(store.getState().car.speed).toBeGreaterThan(0);
  });

  it('Enter skips the intro straight to the lights', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 3, seed: 'skip' });
    store.getState().start();
    store.getState().step(0.5, COAST);
    store.getState().skipIntro();
    expect(store.getState().phase).toBe('lights');
  });

  it('punishes moving before the lights go out with a five-second penalty', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 1, seed: 'jump', difficulty: 'easy' });
    store.getState().start();
    store.getState().skipIntro();
    for (let t = 0; t < 3; t += 1 / 60) store.getState().step(1 / 60, FULL_THROTTLE);
    expect(store.getState().jumpStart).toBe(true);
    expect(store.getState().events.some((event) => event.kind === 'jump')).toBe(true);
    // The car crept but was held to a crawl: nowhere near Turn 1.
    expect(store.getState().car.speed).toBeLessThanOrEqual(6);
    launch(store);
    autopilot(store, 300);
    const state = store.getState();
    expect(state.phase).toBe('finished');
    const me = state.classification.find((row) => row.isPlayer)!;
    expect(me.penaltySeconds).toBe(JUMP_START_PENALTY_SECONDS);
    expect(state.raceTime).toBeCloseTo(state.elapsed + JUMP_START_PENALTY_SECONDS, 6);
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
    launch(store);
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
    launch(store);
    autopilot(store, 400);
    const state = store.getState();
    expect(state.phase).toBe('finished');
    expect(state.finishPosition).not.toBeNull();
    expect(state.finishPosition!).toBeGreaterThanOrEqual(1);
    expect(state.finishPosition!).toBeLessThanOrEqual(DRIVERS_2026.length);
    expect(state.lapTimes).toHaveLength(2);
    // Everyone is classified exactly once, in order, gaps from the winner.
    expect(state.classification).toHaveLength(DRIVERS_2026.length);
    expect(state.classification.map((row) => row.position)).toEqual(DRIVERS_2026.map((_, index) => index + 1));
    expect(state.classification[0].gap).toBe(0);
    for (let index = 1; index < state.classification.length; index += 1) {
      expect(state.classification[index].raceTime).toBeGreaterThanOrEqual(state.classification[index - 1].raceTime);
    }
    expect(state.classification.filter((row) => row.fastestLap)).toHaveLength(1);
    expect(state.classification.find((row) => row.isPlayer)!.position).toBe(state.finishPosition);
    expect(state.events[state.events.length - 1].kind).toBe('flag');
  });

  it('never lets two rivals in the same lane share tarmac', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 3, seed: 'spacing', difficulty: 'hard' });
    launch(store);
    let closest = Number.POSITIVE_INFINITY;
    for (let t = 0; t < 90; t += 1 / 60) {
      store.getState().step(1 / 60, COAST);
      const running = store.getState().ai.filter((car) => car.status === 'running' && car.pitState === 'track');
      for (const a of running) {
        for (const b of running) {
          if (a === b || Math.abs(a.lateralOffset - b.lateralOffset) >= 2.4) continue;
          const gap = Math.abs(((a.lap + a.distance) - (b.lap + b.distance)) * projectedTrack.lengthMeters);
          closest = Math.min(closest, gap);
        }
      }
    }
    expect(closest).toBeGreaterThanOrEqual(9 - 1e-6);
  });

  it('starts one clear row behind the last AI car, never inside it', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 3, seed: 'grid-row' });
    const { car, ai } = store.getState();
    let closest = Number.POSITIVE_INFINITY;
    for (const rival of ai) {
      const { point } = projectedTrack.at(rival.distance, rival.lateralOffset);
      closest = Math.min(closest, Math.hypot(point.x - car.x, point.z - car.z));
    }
    expect(closest).toBeGreaterThan(6);
    // The first racing step must not shove the car sideways out of its slot.
    launch(store);
    expect(Math.abs(store.getState().lateral)).toBeLessThan(3.4);
    expect(store.getState().hitCar).toBe(0);
  });

  it('moves rivals near the player to the other side of the track', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 3, seed: 'avoid', difficulty: 'easy' });
    launch(store);
    let checked = 0;
    for (let t = 0; t < 6; t += 1 / 60) {
      store.getState().step(1 / 60, FULL_THROTTLE);
      const state = store.getState();
      if (t < 2) continue; // let the move settle
      for (const rival of state.ai) {
        const along = Math.abs((rival.lap + rival.distance) - (state.lap + state.fraction)) * projectedTrack.lengthMeters;
        if (rival.status !== 'running' || along > 12) continue;
        checked += 1;
        expect(Math.sign(rival.lateralOffset)).toBe(-Math.sign(state.lateral));
        expect(Math.abs(rival.lateralOffset - state.lateral)).toBeGreaterThan(2.4);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('resets the car onto the racing line after going off', () => {
    const store = createGameStore();
    store.getState().configure({ driverId: 'norris', laps: 3, seed: 'reset' });
    launch(store);
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

/** Skips the intro and steps through the lights until the race is live. */
function launch(store: ReturnType<typeof createGameStore>) {
  if (store.getState().phase === 'setup') store.getState().start();
  store.getState().skipIntro();
  for (let t = 0; t < 10 && store.getState().phase === 'lights'; t += 1 / 60) store.getState().step(1 / 60, COAST);
  expect(store.getState().phase).toBe('racing');
}
