import { describe, expect, it } from 'vitest';
import { CAR, createCarState, gearFor, stepCar, type CarInput } from '../../src/game/car-physics';
import { constrainToWalls, createProjectedTrack } from '../../src/game/track-projection';
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

  it('keeps height continuous along the lap instead of stepping sample to sample', () => {
    let previous = track.at(0).point;
    let maxJump = 0;
    for (let f = 0.0002; f < 1; f += 0.0002) {
      const { point } = track.at(f);
      const travel = Math.hypot(point.x - previous.x, point.z - previous.z);
      if (travel > 0.15) maxJump = Math.max(maxJump, Math.abs(point.y - previous.y));
      previous = point;
    }
    // A metre of Shanghai never climbs more than a few centimetres. A raw
    // 2048-sample hop on the T1 rise was several times that, and the chase
    // camera read it as the car bouncing.
    expect(maxJump).toBeLessThan(0.12);
  });
});

describe('barriers', () => {
  const track = createProjectedTrack(SHANGHAI_TRACK);

  it('holds a car that has crossed the wall back on the wall line', () => {
    const { point, tangent } = track.at(0.3);
    // 20 m left of the centreline is well past the barrier.
    const far = { x: point.x - tangent.z * 20, z: point.z + tangent.x * 20, heading: 0, speed: 60 };
    const projection = track.project(far.x, far.z, 0.3);
    const held = constrainToWalls(far, projection, track.wallHalfWidth);
    expect(held.hitWall).toBe(true);
    const after = track.project(held.x, held.z, 0.3);
    expect(Math.abs(after.lateral)).toBeLessThanOrEqual(track.wallHalfWidth + 0.05);
    expect(held.speed).toBeLessThan(far.speed);
  });

  it('leaves a car inside the walls untouched', () => {
    const { point } = track.at(0.5);
    const inside = { x: point.x, z: point.z, heading: 1, speed: 50 };
    const held = constrainToWalls(inside, track.project(point.x, point.z, 0.5), track.wallHalfWidth);
    expect(held.hitWall).toBe(false);
    expect(held).toMatchObject(inside);
  });

  it('costs more speed for a head-on hit than a glancing one', () => {
    const { point, tangent } = track.at(0.2);
    const trackHeading = Math.atan2(tangent.z, tangent.x);
    const at = { x: point.x - tangent.z * 12, z: point.z + tangent.x * 12 };
    const projection = track.project(at.x, at.z, 0.2);
    const glancing = constrainToWalls({ ...at, heading: trackHeading + 0.1, speed: 60 }, projection, track.wallHalfWidth);
    const headOn = constrainToWalls({ ...at, heading: trackHeading + 1.4, speed: 60 }, projection, track.wallHalfWidth);
    expect(headOn.speed).toBeLessThan(glancing.speed);
  });
});

describe('handling', () => {
  it('turns sharply at low speed', () => {
    // From 20 m/s, full lock for one second should swing the heading well over 45°.
    let state = createCarState(0, 0, 0);
    state = { ...state, speed: 20 };
    for (let t = 0; t < 1; t += 1 / 120) state = stepCar(state, { ...idle, throttle: 0.3, steer: 1 }, ON_TRACK, 1 / 120);
    expect(state.heading).toBeGreaterThan(Math.PI / 4);
  });

  it('still turns meaningfully at high speed', () => {
    let state = createCarState(0, 0, 0);
    state = { ...state, speed: 75 };
    for (let t = 0; t < 1; t += 1 / 120) state = stepCar(state, { ...idle, throttle: 1, steer: 1 }, ON_TRACK, 1 / 120);
    expect(state.heading).toBeGreaterThan(0.35);
  });

  it('scrubs speed through a hard corner so braking matters', () => {
    const straight = run({ ...idle, throttle: 1 }, 6);
    let cornering = { ...straight };
    let noCorner = { ...straight };
    for (let t = 0; t < 2; t += 1 / 120) {
      cornering = stepCar(cornering, { ...idle, throttle: 1, steer: 1 }, ON_TRACK, 1 / 120);
      noCorner = stepCar(noCorner, { ...idle, throttle: 1 }, ON_TRACK, 1 / 120);
    }
    expect(cornering.speed).toBeLessThan(noCorner.speed);
  });
});
