import { SHANGHAI_TRACK } from '../track/shanghai-track';
import { projectedTrack } from './game-store';

/**
 * The circuit as a 0-100 square for the HUD mini-map, plus the sector splits
 * and passing zones drawn on it. Built from the same projected track the cars
 * are placed on, so a dot at lap fraction f sits exactly on the drawn line.
 */
const SAMPLES = 240;

interface Bounds {
  minX: number;
  minZ: number;
  span: number;
}

function bounds(): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < SAMPLES; index += 1) {
    const { point } = projectedTrack.at(index / SAMPLES);
    minX = Math.min(minX, point.x);
    minZ = Math.min(minZ, point.z);
    maxX = Math.max(maxX, point.x);
    maxZ = Math.max(maxZ, point.z);
  }
  return { minX, minZ, span: Math.max(maxX - minX, maxZ - minZ) || 1 };
}

const BOUNDS = bounds();
/** Padding inside the 0-100 box so dots on the outer edge are not clipped. */
const PAD = 6;

export function mapPoint(fraction: number, lateral = 0): { x: number; y: number } {
  const { point } = projectedTrack.at(fraction, lateral);
  return {
    x: PAD + ((point.x - BOUNDS.minX) / BOUNDS.span) * (100 - PAD * 2),
    y: PAD + ((point.z - BOUNDS.minZ) / BOUNDS.span) * (100 - PAD * 2),
  };
}

function pathBetween(start: number, end: number): string {
  const steps = Math.max(2, Math.round(((end - start + 1) % 1 || 1) * SAMPLES));
  let d = '';
  for (let index = 0; index <= steps; index += 1) {
    const fraction = start + ((end - start + 1) % 1 || 1) * (index / steps);
    const { x, y } = mapPoint(fraction);
    d += `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
}

export const MINIMAP_OUTLINE = `${pathBetween(0, 1)} Z`;

/** Passing (DRS) zones as separate path segments, drawn in the accent colour. */
export const MINIMAP_PASSING_ZONES = SHANGHAI_TRACK.zones
  .filter((zone) => zone.kind === 'passing')
  .map((zone) => pathBetween(zone.start, zone.end));

/** Start/finish line: a short tick across the track at fraction 0. */
export const MINIMAP_START = (() => {
  const a = mapPoint(0, -9);
  const b = mapPoint(0, 9);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
})();
