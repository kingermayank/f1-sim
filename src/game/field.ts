import type { CarState as AiCarState } from '../simulation/events';

/**
 * The AI field as the player meets it on track.
 *
 * The race engine is authoritative about who is where in lap terms, but two
 * matched drivers can legitimately be a metre apart, which in a driving game
 * puts one car inside another. So before the player races them, the field is
 * spaced nose-to-tail and rivals near the player move off the racing line to
 * leave room. Both are pure functions of the engine snapshot plus a little
 * smoothed state, and the engine never sees them.
 */

/** Real 2026-era car length; the circuit is authored in metres. */
export const CAR_LENGTH_METRES = 5.6;
export const CAR_WIDTH_METRES = 2.0;
/** Minimum rendered nose-to-tail distance between two AI cars. */
export const MIN_AI_GAP_METRES = 9;

/**
 * Holds every running AI car at least one gap behind the nearest car ahead in
 * its lane. Cars offset far enough sideways to be alongside (grid pairs, an
 * attack line against a defend line) are left alone. The pass cascades from
 * the leader, so a train of cars cannot collapse together.
 */
export function spaceField(cars: readonly AiCarState[], lengthMeters: number): AiCarState[] {
  const minGap = MIN_AI_GAP_METRES / lengthMeters;
  const laneWidth = CAR_WIDTH_METRES + 0.4;
  const order = cars
    .map((car, index) => ({ car, index, progress: car.lap + car.distance }))
    .filter(({ car }) => car.status === 'running' && car.pitState === 'track')
    .sort((a, b) => b.progress - a.progress);

  const result = cars.slice();
  const held: { progress: number; lateral: number }[] = [];
  for (const entry of order) {
    let limit = Number.POSITIVE_INFINITY;
    for (const ahead of held) {
      if (Math.abs(ahead.lateral - entry.car.lateralOffset) < laneWidth) limit = Math.min(limit, ahead.progress - minGap);
    }
    const progress = Math.min(entry.progress, limit);
    held.push({ progress, lateral: entry.car.lateralOffset });
    if (progress !== entry.progress) {
      const lap = Math.floor(progress);
      result[entry.index] = { ...entry.car, lap, distance: progress - lap };
    }
  }
  return result;
}

export interface AvoidanceOptions {
  /** How far (in lap fraction) ahead or behind the player a rival starts to move over. */
  rangeLaps: number;
  /** Lateral metres a rival offsets by when the player is alongside. */
  offsetMetres: number;
  /** Track half-width the rival may use. */
  halfWidth: number;
}

/**
 * Lateral target for one rival given where the player is. Rivals within range
 * of the player longitudinally move to the side of the track the player is not
 * on; everyone else runs the racing line. Smoothing is the caller's job.
 */
export function avoidanceTarget(
  rivalProgress: number,
  playerProgress: number,
  playerLateral: number,
  options: AvoidanceOptions,
): number {
  const delta = Math.abs(rivalProgress - playerProgress);
  if (delta > options.rangeLaps) return 0;
  const side = playerLateral >= 0 ? -1 : 1;
  const offset = Math.min(options.offsetMetres, options.halfWidth - CAR_WIDTH_METRES / 2);
  // Ease in over the outer half of the range so the move reads as a decision, not a snap.
  const weight = Math.min(1, (options.rangeLaps - delta) / (options.rangeLaps * 0.5));
  return side * offset * weight;
}

export interface Pose {
  x: number;
  z: number;
  heading: number;
}

export interface ContactResult {
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** Set when the player touched another car this step, with the impact in [0, 1]. */
  contact: number;
}

/**
 * Car-to-car contact, resolved for the player only. Each car is two circles
 * (front and rear axle) so a nose-to-tail touch and a side-by-side touch feel
 * different; the player is pushed out of the overlap along the shortest axis
 * and loses speed in proportion to how squarely they hit.
 */
export function resolveCarContact(
  player: Pose & { speed: number },
  rivals: readonly Pose[],
): ContactResult {
  const axle = CAR_LENGTH_METRES * 0.32;
  const radius = CAR_WIDTH_METRES * 0.62;
  let { x, z, heading, speed } = player;
  let contact = 0;

  const circles = (pose: Pose, px: number, pz: number) => [
    { x: px + Math.cos(pose.heading) * axle, z: pz + Math.sin(pose.heading) * axle },
    { x: px - Math.cos(pose.heading) * axle, z: pz - Math.sin(pose.heading) * axle },
  ];

  for (const rival of rivals) {
    const theirs = circles(rival, rival.x, rival.z);
    // Iterate a couple of times so resolving one circle pair does not leave another overlapping.
    for (let pass = 0; pass < 2; pass += 1) {
      const mine = circles({ x, z, heading }, x, z);
      let deepest = 0;
      let nx = 0;
      let nz = 0;
      for (const a of mine) {
        for (const b of theirs) {
          const dx = a.x - b.x;
          const dz = a.z - b.z;
          const distance = Math.hypot(dx, dz);
          const overlap = radius * 2 - distance;
          if (overlap > deepest) {
            deepest = overlap;
            if (distance > 1e-6) { nx = dx / distance; nz = dz / distance; }
            else { nx = -Math.cos(heading); nz = -Math.sin(heading); }
          }
        }
      }
      if (deepest <= 0) break;
      x += nx * deepest;
      z += nz * deepest;
      // Squareness of the hit: 1 when the push is straight back along the car, 0 when it is sideways.
      const along = Math.abs(nx * Math.cos(heading) + nz * Math.sin(heading));
      const impact = Math.min(1, deepest / radius) * (0.4 + 0.6 * along);
      contact = Math.max(contact, impact);
      speed *= 1 - 0.35 * impact;
      // A glancing touch nudges the nose away from the other car.
      const side = Math.sign(-nx * Math.sin(heading) + nz * Math.cos(heading)) || 1;
      heading += side * (1 - along) * 0.05 * Math.min(1, deepest / radius);
    }
  }

  return { x, z, heading, speed, contact };
}
