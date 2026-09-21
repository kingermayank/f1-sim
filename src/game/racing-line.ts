import { CAR } from './car-physics';
import type { ProjectedTrack } from './track-projection';

/**
 * The driving guide: how hard the car can go at every point of the lap,
 * derived from the same physics the car runs on.
 *
 * 1. Corner speed. The car's lateral grip is `baseGrip + downforceGrip·v²`;
 *    holding a curve of curvature κ needs `v²·κ` of it. Solving gives the
 *    fastest speed that stays on the road at each point.
 * 2. Braking. Walking the lap backwards, no point may be faster than the
 *    brakes can shed before the slower point ahead.
 * 3. Acceleration. Walking forwards, no point may be faster than the engine
 *    can reach from the point behind.
 *
 * Effort is then read off the profile: braking where the target speed falls,
 * lifting where the car is held at the corner limit, throttle elsewhere.
 */
export interface GuideSample {
  /** Lap fraction in [0, 1). */
  fraction: number;
  /** Target speed here, m/s. */
  speed: number;
  /** 0 = flat out, ~0.5 = at the limit or lifting, 1 = hardest braking. */
  effort: number;
}

/** Keep a little in hand: the guide should not be the exact edge of grip. */
const CORNER_MARGIN = 0.92;
/**
 * The guide brakes like a person, not like the physics: at this fraction of
 * the car's full braking the red zones start early enough to react to.
 */
const GUIDE_BRAKE_FRACTION = 0.6;
/** Deceleration below this (m/s²) is a lift, not braking. */
const BRAKE_THRESHOLD = 2.5;
/** A yellow warning runs this far before every braking zone. */
const WARNING_METRES = 30;

export function computeRacingGuide(track: ProjectedTrack, samples = 2560): GuideSample[] {
  const step = track.lengthMeters / samples;
  const points = Array.from({ length: samples }, (_, index) => track.at(index / samples));

  // Curvature from the turn of the tangent over one step.
  const curvature = points.map((_, index) => {
    const before = points[(index - 1 + samples) % samples].tangent;
    const after = points[(index + 1) % samples].tangent;
    const angle = Math.atan2(before.x * after.z - before.z * after.x, before.x * after.x + before.z * after.z);
    return Math.abs(angle) / (2 * step);
  });

  // Corner-limited speed. Below the downforce break-even the car is limited
  // only by drag: v²·(κ − downforceGrip) ≤ baseGrip.
  const speed = curvature.map((kappa) => {
    const excess = kappa - CAR.downforceGrip;
    if (excess <= 1e-6) return CAR.topSpeed;
    return Math.min(CAR.topSpeed, Math.sqrt(CAR.baseGrip / excess) * CORNER_MARGIN);
  });

  const brakeDecel = (v: number) => (GUIDE_BRAKE_FRACTION * (CAR.brakeForce + CAR.dragCoefficient * v * v + CAR.rollingResistance)) / CAR.mass;
  const engineAccel = (v: number) => Math.max(0.5, (CAR.engineForce - CAR.dragCoefficient * v * v - CAR.rollingResistance) / CAR.mass);

  // Two laps of each pass so the wrap at the line converges.
  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = samples * 2 - 1; index >= 0; index -= 1) {
      const here = index % samples;
      const ahead = (here + 1) % samples;
      const limit = Math.sqrt(speed[ahead] ** 2 + 2 * brakeDecel(speed[ahead]) * step);
      speed[here] = Math.min(speed[here], limit);
    }
    for (let index = 0; index < samples * 2; index += 1) {
      const here = index % samples;
      const behind = (here - 1 + samples) % samples;
      const limit = Math.sqrt(speed[behind] ** 2 + 2 * engineAccel(speed[behind]) * step);
      speed[here] = Math.min(speed[here], limit);
    }
  }

  const raw = speed.map((v, index) => {
    const next = speed[(index + 1) % samples];
    const decel = (v * v - next * next) / (2 * step);
    if (decel > BRAKE_THRESHOLD) return 0.55 + 0.45 * Math.min(1, decel / brakeDecel(v));
    // Held under the top speed without braking: at the corner limit or lifting into it.
    if (v < CAR.topSpeed * 0.97 && next <= v + 0.05) return 0.45;
    return 0;
  });

  // A lift warning ahead of each braking zone, then a short smoothing so the
  // colour reads as a gradient rather than a flicker of segments.
  const warning = Math.round(WARNING_METRES / step);
  const warned = raw.slice();
  for (let index = 0; index < samples; index += 1) {
    if (raw[index] < 0.55) continue;
    for (let back = 1; back <= warning; back += 1) {
      const target = (index - back + samples) % samples;
      if (raw[target] < 0.55) warned[target] = Math.max(warned[target], 0.45);
    }
  }
  const effort = warned.map((_, index) => {
    let sum = 0;
    for (let offset = -2; offset <= 2; offset += 1) sum += warned[(index + offset + samples) % samples];
    return sum / 5;
  });

  return points.map((_, index) => ({ fraction: index / samples, speed: speed[index], effort: effort[index] }));
}

/** Guide colour for an effort value: green → yellow → red. */
export function guideColor(effort: number): [number, number, number] {
  const green: [number, number, number] = [0.24, 0.86, 0.42];
  const yellow: [number, number, number] = [1.0, 0.82, 0.25];
  const red: [number, number, number] = [1.0, 0.23, 0.19];
  const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
    a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
  ];
  const e = Math.max(0, Math.min(1, effort));
  return e < 0.5 ? mix(green, yellow, e / 0.5) : mix(yellow, red, (e - 0.5) / 0.5);
}
