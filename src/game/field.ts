import type { CarState as AiCarState } from '../simulation/events';

/**
 * The AI field as the player meets it on track.
 *
 * The race engine is authoritative about who is where in lap terms, but two
 * matched drivers can legitimately be a metre apart, which in a driving game
 * puts one car inside another. So before the player races them, the field is
 * spaced nose-to-tail, and a rival catching the player pulls out to pass
 * rather than driving through them. Both are pure functions of the engine
 * snapshot plus a little smoothed state, and the engine never sees them.
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

export interface OvertakeOptions {
  /** How far behind the player (metres) a faster rival starts planning its pass. */
  behindMetres: number;
  /** How far past the player (metres) it holds its passing line before rejoining its own. */
  clearMetres: number;
  /** Lateral distance (metres) it keeps from the player while alongside. */
  passGapMetres: number;
  /** Track half-width the rival may use. */
  halfWidth: number;
}

/**
 * Where a rival wants to be across the track, given the player.
 *
 * Rivals race their own line and never move out of the way of a car behind
 * them: that is the player's job, as in a real race. A rival closing on the
 * player from behind pulls out to overtake, on the side it is already on (or
 * the side with more room when it is right behind), holds that line while
 * alongside, and rejoins its own line once it is clear. `side` is the side
 * already chosen for this pass, so a rival never changes its mind halfway
 * and crosses the player's nose; null when it has not chosen one yet.
 *
 * Returns the lateral target and the side, or null when the rival should
 * simply race its own line.
 */
export function overtakeTarget(
  ownLateral: number,
  gapMetres: number,
  closingSpeed: number,
  playerLateral: number,
  side: number | null,
  options: OvertakeOptions,
): { lateral: number; side: number } | null {
  // gapMetres: rival progress minus the player's, so negative when it is behind.
  const passing = side !== null
    ? gapMetres > -options.behindMetres && gapMetres < options.clearMetres
    : gapMetres < 0 && gapMetres > -options.behindMetres && closingSpeed > 0.5;
  if (!passing) return null;
  // Already clear of the player sideways: no need to move.
  if (side === null && Math.abs(ownLateral - playerLateral) >= options.passGapMetres) return null;
  const limit = options.halfWidth - CAR_WIDTH_METRES / 2;
  let chosen = side;
  if (chosen === null) {
    const preferred = Math.sign(ownLateral - playerLateral) || (playerLateral >= 0 ? -1 : 1);
    const roomPreferred = limit - preferred * playerLateral;
    chosen = roomPreferred >= options.passGapMetres ? preferred : -preferred;
  }
  const lateral = Math.max(-limit, Math.min(limit, playerLateral + chosen * options.passGapMetres));
  return { lateral, side: chosen };
}

/**
 * Moves a lateral position toward its target the way a car changes line: an
 * eased approach, never faster than `rate` metres a second sideways.
 */
export function steerLateral(current: number, target: number, rate: number, dt: number): number {
  const eased = (target - current) * Math.min(1, dt * 2.2);
  const limit = rate * dt;
  return current + Math.max(-limit, Math.min(limit, eased));
}

export interface Pose {
  x: number;
  z: number;
  heading: number;
  /** The rival's speed along its heading, m/s, for a rear-end bump. */
  speed?: number;
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
 * different. The player is pushed out of the overlap along the shortest axis.
 * A square hit on a slower car is a bump: the player drops to just under the
 * other car's speed, not to a standstill. A side touch costs a little speed
 * and nudges the nose away.
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
      if (along > 0.6) {
        // Nose-to-tail: match the car in front rather than stop behind it.
        const theirs = rival.speed ?? speed * 0.85;
        speed = Math.min(speed, Math.max(theirs - 1.5, speed * 0.6));
      } else {
        speed *= 1 - 0.06 * impact;
      }
      // A glancing touch nudges the nose away from the other car.
      const side = Math.sign(-nx * Math.sin(heading) + nz * Math.cos(heading)) || 1;
      heading += side * (1 - along) * 0.05 * Math.min(1, deepest / radius);
    }
  }

  return { x, z, heading, speed, contact };
}
