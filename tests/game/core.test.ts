import { describe, expect, it } from 'vitest';
import { CAR, createCarState, gearFor, stepCar, type CarInput } from '../../src/game/car-physics';
import { createProjectedTrack } from '../../src/game/track-projection';
import { SHANGHAI_TRACK } from '../../src/track/shanghai-track';

const ON_TRACK = { onTrack: true, drsAvailable: false };
const idle: CarInput = { throttle: 0, brake: 0, steer: 0, drs: false };

function run(input: CarInput, seconds: number, env = ON_TRACK, start = createCarState(0, 0, 0)) {
  let state = start;
  const dt = 1 / 120;
  for (let t = 0; t < seconds; t += dt) state = stepCar(state, input, env, dt);
  return state;
}

describe('car physics', () => {
  it('accelerates under throttle and approaches, but never exceeds, top speed', () => {
    const after5 = run({ ...idle, throttle: 1 }, 5);
    const after30 = run({ ...idle, throttle: 1 }, 30);
    expect(after5.speed).toBeGreaterThan(40);
    expect(after30.speed).toBeGreaterThan(after5.speed);
    expect(after30.speed).toBeLessThanOrEqual(CAR.topSpeed);
    expect(after30.speed).toBeGreaterThan(CAR.topSpeed * 0.9);
  });

  it('brakes to a stop and does not reverse under braking alone', () => {
    const fast = run({ ...idle, throttle: 1 }, 10);
    const stopped = run({ ...idle, brake: 1 }, 10, ON_TRACK, fast);
    expect(stopped.speed).toBe(0);
  });

  it('turns when steered and holds a straight line when not', () => {
    const straight = run({ ...idle, throttle: 1 }, 4);
    expect(Math.abs(straight.heading)).toBeLessThan(1e-6);
    const turned = run({ ...idle, throttle: 1, steer: 1 }, 4);
    expect(turned.heading).toBeGreaterThan(0.2);
  });

  it('runs wide rather than spinning when asked for more than the grip allows', () => {
    // Full lock at high speed must be grip-limited: heading changes far less
    // than the raw bicycle model would demand, and slip reports it.
    const fast = run({ ...idle, throttle: 1 }, 15);
    const next = stepCar(fast, { ...idle, throttle: 1, steer: 1 }, ON_TRACK, 1 / 60);
    const lock = CAR.maxSteer * CAR.highSpeedSteerFraction;
    const rawYaw = (fast.speed / CAR.wheelbase) * Math.tan(lock);
    const actualYaw = (next.heading - fast.heading) * 60;
    expect(actualYaw).toBeLessThan(rawYaw);
    expect(actualYaw).toBeGreaterThan(0);
  });

  it('is slower and looser on the grass', () => {
    const onTrack = run({ ...idle, throttle: 1 }, 8);
    const onGrass = run({ ...idle, throttle: 1 }, 8, { onTrack: false, drsAvailable: false });
    expect(onGrass.speed).toBeLessThan(onTrack.speed * 0.75);
  });

  it('only lets DRS raise the top speed when it is actually available', () => {
    const withoutZone = run({ ...idle, throttle: 1, drs: true }, 40);
    const withZone = run({ ...idle, throttle: 1, drs: true }, 40, { onTrack: true, drsAvailable: true });
    expect(withoutZone.speed).toBeLessThanOrEqual(CAR.topSpeed);
    expect(withZone.speed).toBeGreaterThan(CAR.topSpeed);
    expect(withZone.speed).toBeLessThanOrEqual(CAR.drsTopSpeed);
  });

  it('reports sensible gears across the speed range', () => {
    expect(gearFor(0).gear).toBe(1);
    expect(gearFor(20).gear).toBeGreaterThan(1);
    expect(gearFor(84).gear).toBe(8);
    for (const v of [5, 20, 40, 60, 80]) {
      const { rpm } = gearFor(v);
      expect(rpm).toBeGreaterThan(0.3);
      expect(rpm).toBeLessThanOrEqual(1);
    }
  });
});

describe('track projection', () => {
  const track = createProjectedTrack(SHANGHAI_TRACK);

  it('maps the start/finish line to fraction zero and centreline points to zero lateral', () => {
    const start = SHANGHAI_TRACK.centerLine[0];
    const projection = track.project(start.x, start.z);
    expect(Math.min(projection.fraction, 1 - projection.fraction)).toBeLessThan(0.005);
    expect(Math.abs(projection.lateral)).toBeLessThan(0.5);
  });

  it('measures lateral offset with sign relative to travel', () => {
    const { point, tangent } = track.at(0.3);
    const left = track.project(point.x - tangent.z * 4, point.z + tangent.x * 4, 0.3);
    const right = track.project(point.x + tangent.z * 4, point.z - tangent.x * 4, 0.3);
    expect(left.lateral).toBeGreaterThan(3.5);
    expect(right.lateral).toBeLessThan(-3.5);
  });

  it('advances fraction monotonically along the lap', () => {
    let previous = track.project(track.at(0.02).point.x, track.at(0.02).point.z).fraction;
    for (let f = 0.05; f < 0.98; f += 0.03) {
      const { point } = track.at(f);
      const { fraction } = track.project(point.x, point.z, previous);
      expect(fraction).toBeGreaterThan(previous);
      previous = fraction;
    }
  });

  it('knows where the DRS zones are', () => {
    expect(track.inPassingZone(0.74)).toBe(true);
    expect(track.inPassingZone(0.98)).toBe(true);
    expect(track.inPassingZone(0.4)).toBe(false);
  });
});
