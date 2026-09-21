import { CatmullRomCurve3, Vector3 } from 'three';
import type { TrackDefinition } from '../track/track-types';

/**
 * Projects a free-moving car onto the circuit spline.
 *
 * The player is not on rails, so every frame we need to know: how far around
 * the lap they are (for lap counting and position against the AI), how far off
 * the racing line they are (for track limits), and which way the track runs
 * there (for the chase camera and the mini-map). A dense pre-sampled table
 * answers all three in constant time.
 */
export interface TrackProjection {
  /** Lap fraction in [0, 1), 0 at the start/finish line. */
  fraction: number;
  /** Signed metres from the centreline; positive is to the left of travel. */
  lateral: number;
  /** Nearest centreline point. */
  point: Vector3;
  /** Unit tangent of the track at that point, in the direction of travel. */
  tangent: Vector3;
}

export interface ProjectedTrack {
  readonly lengthMeters: number;
  /** Half the drivable tarmac width; beyond this is kerb and grass. */
  readonly halfWidth: number;
  /** Half-width at the barrier. The car is physically held inside this. */
  readonly wallHalfWidth: number;
  project(x: number, z: number, hint?: number): TrackProjection;
  /** World point and tangent at a lap fraction, for grid placement. */
  at(fraction: number, lateral?: number): { point: Vector3; tangent: Vector3 };
  /** True inside a passing (DRS) zone. */
  inPassingZone(fraction: number): boolean;
}

const SAMPLES = 2048;

export function createProjectedTrack(track: TrackDefinition, halfWidth = 6.8, wallHalfWidth = 8.4): ProjectedTrack {
  const curve = new CatmullRomCurve3(
    track.centerLine.map((p) => new Vector3(p.x, p.y, p.z)),
    true,
    'catmullrom',
    0.5,
  );

  const points: Vector3[] = [];
  const tangents: Vector3[] = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    const t = index / SAMPLES;
    points.push(curve.getPointAt(t));
    tangents.push(curve.getTangentAt(t).normalize());
  }

  const passing = track.zones.filter((zone) => zone.kind === 'passing');

  function nearestIndex(x: number, z: number, hint?: number): number {
    // With a hint, search a local window: the car cannot jump a quarter of a
    // lap in one frame, and a local search cannot snap to a nearby part of the
    // circuit that happens to pass close by (Shanghai's straights run parallel).
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    const window = hint === undefined ? SAMPLES : 96;
    const start = hint === undefined ? 0 : Math.round(hint * SAMPLES) - window / 2;
    for (let offset = 0; offset < window; offset += 1) {
      const index = ((start + offset) % SAMPLES + SAMPLES) % SAMPLES;
      const p = points[index];
      const dx = p.x - x;
      const dz = p.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestDistance) {
        bestDistance = d;
        best = index;
      }
    }
    return best;
  }

  return {
    lengthMeters: track.lengthMeters,
    halfWidth,
    wallHalfWidth,

    project(x, z, hint) {
      const index = nearestIndex(x, z, hint);
      const point = points[index];
      const tangent = tangents[index];
      // Refine the fraction along the local tangent so it is continuous rather
      // than stepping in 1/2048ths.
      const along = (x - point.x) * tangent.x + (z - point.z) * tangent.z;
      const segment = track.lengthMeters / SAMPLES;
      const fraction = (((index + along / segment) / SAMPLES) % 1 + 1) % 1;
      // Left of travel is +ve: cross(up, tangent) gives the left normal.
      const leftX = -tangent.z;
      const leftZ = tangent.x;
      const lateral = (x - point.x) * leftX + (z - point.z) * leftZ;
      return { fraction, lateral, point, tangent };
    },

    at(fraction, lateral = 0) {
      const index = ((Math.round((((fraction % 1) + 1) % 1) * SAMPLES)) % SAMPLES + SAMPLES) % SAMPLES;
      const point = points[index].clone();
      const tangent = tangents[index];
      point.x += -tangent.z * lateral;
      point.z += tangent.x * lateral;
      return { point, tangent };
    },

    inPassingZone(fraction) {
      const f = ((fraction % 1) + 1) % 1;
      return passing.some((zone) => (zone.start <= zone.end
        ? f >= zone.start && f <= zone.end
        : f >= zone.start || f <= zone.end));
    },
  };
}

export interface WallContact {
  x: number;
  z: number;
  heading: number;
  speed: number;
  hitWall: boolean;
}

/**
 * Holds the car inside the barriers.
 *
 * If the car has crossed the wall line it is put back on it, its heading is
 * pulled toward the track direction so it slides along the wall rather than
 * pinning into it, and it loses speed for the contact. This is what stops a
 * car from wandering out over terrain the circuit model never intended to be
 * driven on — the source of the "floating above the ground" bug.
 */
export function constrainToWalls(
  car: { x: number; z: number; heading: number; speed: number },
  projection: TrackProjection,
  wallHalfWidth: number,
): WallContact {
  const over = Math.abs(projection.lateral) - wallHalfWidth;
  if (over <= 0) return { ...car, hitWall: false };

  const side = Math.sign(projection.lateral);
  const leftX = -projection.tangent.z;
  const leftZ = projection.tangent.x;
  // Move back to the wall line along the track normal.
  const x = car.x - leftX * over * side;
  const z = car.z - leftZ * over * side;

  // Steer the heading toward the track direction, scaled by how hard the car
  // went in, so a glancing touch barely deflects and a head-on hit turns it.
  const trackHeading = Math.atan2(projection.tangent.z, projection.tangent.x);
  let error = trackHeading - car.heading;
  while (error > Math.PI) error -= Math.PI * 2;
  while (error < -Math.PI) error += Math.PI * 2;
  const heading = car.heading + error * 0.35;

  // Scrub speed for the contact; harder angles cost more.
  const impact = Math.min(1, Math.abs(Math.sin(error)));
  const speed = car.speed * (0.92 - impact * 0.4);

  return { x, z, heading, speed, hitWall: true };
}
