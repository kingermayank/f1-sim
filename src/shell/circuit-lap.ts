import type { TrackDefinition, TrackPoint } from '../track/track-types';

/**
 * A lap of a circuit, small enough for a button: the outline traced from the
 * simulation's own centreline, and a lap-time model so a dot running round it
 * brakes into the corners and accelerates out of them, the way a car does.
 *
 * Corner speed comes from the local radius with a downforce-style grip that
 * grows with speed; braking and traction limits are then applied forwards
 * and backwards round the lap. Sector chips light for the modelled sector
 * times, not equal thirds.
 */

const G = 9.81;
const SAMPLES = 360;

export interface LapModel {
  /** Closed outline in the box's coordinates. */
  path: string;
  /** The three sectors as open polylines, for highlighting. */
  sectorPaths: [string, string, string];
  /** A short tick across the track at the start/finish line. */
  startTick: { x1: number; y1: number; x2: number; y2: number };
  /** Modelled lap time, seconds. */
  lapSeconds: number;
  /** Lap-time fractions at which sectors 1 and 2 end (sector 3 ends at 1). */
  sectorEnds: [number, number, 1];
  topSpeedKph: number;
  /** Where the dot is at a fraction of the lap's time, in box coordinates. */
  at(timeFraction: number): { x: number; y: number };
}

interface Sample { x: number; z: number; s: number }

function resample(points: readonly TrackPoint[], count: number): Sample[] {
  const lengths = [0];
  for (let index = 1; index <= points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index % points.length];
    lengths.push(lengths[index - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const total = lengths[lengths.length - 1];
  const out: Sample[] = [];
  let segment = 0;
  for (let index = 0; index < count; index += 1) {
    const s = (index / count) * total;
    while (segment < points.length - 1 && lengths[segment + 1] < s) segment += 1;
    const a = points[segment];
    const b = points[(segment + 1) % points.length];
    const span = lengths[segment + 1] - lengths[segment] || 1;
    const t = (s - lengths[segment]) / span;
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, s });
  }
  return out;
}

function circumradius(a: Sample, b: Sample, c: Sample): number {
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const cross = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
  if (cross < 1e-6) return Infinity;
  return (ab * bc * ca) / (2 * cross);
}

export function buildLapModel(track: TrackDefinition, box = { width: 100, height: 64, pad: 4 }): LapModel {
  const samples = resample(track.centerLine, SAMPLES);
  const step = samples[1].s - samples[0].s;
  const n = samples.length;

  // Corner speed limit from the local radius.
  const limit = samples.map((_, index) => {
    const radius = circumradius(samples[(index - 3 + n) % n], samples[index], samples[(index + 3) % n]);
    if (!Number.isFinite(radius)) return 95;
    const denominator = 1 - (radius * G * 3) / 8100;
    if (denominator <= 0.05) return 95;
    return Math.min(95, Math.sqrt((radius * G * 1.8) / denominator));
  });

  // Traction forwards and braking backwards, a few times round the loop.
  const speed = limit.slice();
  for (let pass = 0; pass < 3; pass += 1) {
    for (let k = 0; k < n * 2; k += 1) {
      const index = k % n;
      const previous = speed[(index - 1 + n) % n];
      const accel = G * Math.max(0.25, 1.3 - previous / 110);
      speed[index] = Math.min(speed[index], limit[index], Math.sqrt(previous * previous + 2 * accel * step));
    }
    for (let k = n * 2; k > 0; k -= 1) {
      const index = k % n;
      const next = speed[(index + 1) % n];
      const brake = G * (2 + 3 * (next / 90) ** 2);
      speed[index] = Math.min(speed[index], Math.sqrt(next * next + 2 * brake * step));
    }
  }

  // Cumulative time at each sample.
  const time = [0];
  for (let index = 1; index <= n; index += 1) {
    const average = (speed[index - 1] + speed[index % n]) / 2;
    time.push(time[index - 1] + step / Math.max(1, average));
  }
  const lapSeconds = time[n];

  // Fit the outline into the box, keeping its proportions.
  const xs = samples.map((sample) => sample.x);
  const zs = samples.map((sample) => sample.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const scale = Math.min((box.width - box.pad * 2) / (maxX - minX), (box.height - box.pad * 2) / (maxZ - minZ));
  const offsetX = (box.width - (maxX - minX) * scale) / 2;
  const offsetY = (box.height - (maxZ - minZ) * scale) / 2;
  const project = (sample: { x: number; z: number }) => ({
    x: offsetX + (sample.x - minX) * scale,
    y: offsetY + (sample.z - minZ) * scale,
  });
  const projected = samples.map(project);
  const fmt = (value: number) => value.toFixed(1);
  const polyline = (from: number, to: number) => {
    let d = '';
    for (let index = from; index <= to; index += 1) {
      const point = projected[index % n];
      d += `${index === from ? 'M' : 'L'}${fmt(point.x)} ${fmt(point.y)}`;
    }
    return d;
  };
  const path = `${polyline(0, n - 1)}Z`;

  const sectorIndex = (fraction: number) => Math.round(fraction * n);
  const s1 = sectorIndex(track.sectors[0]);
  const s2 = sectorIndex(track.sectors[1]);
  const sectorPaths: [string, string, string] = [polyline(0, s1), polyline(s1, s2), polyline(s2, n)];

  const tangentX = projected[1].x - projected[n - 1].x;
  const tangentY = projected[1].y - projected[n - 1].y;
  const tangentLength = Math.hypot(tangentX, tangentY) || 1;
  const normalX = -tangentY / tangentLength;
  const normalY = tangentX / tangentLength;
  const start = projected[0];
  const tick = 4.5;

  return {
    path,
    sectorPaths,
    startTick: { x1: start.x - normalX * tick, y1: start.y - normalY * tick, x2: start.x + normalX * tick, y2: start.y + normalY * tick },
    lapSeconds,
    sectorEnds: [time[s1] / lapSeconds, time[s2] / lapSeconds, 1],
    topSpeedKph: Math.max(...speed) * 3.6,
    at(timeFraction: number) {
      const target = (((timeFraction % 1) + 1) % 1) * lapSeconds;
      let low = 0;
      let high = n;
      while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (time[middle] <= target) low = middle; else high = middle;
      }
      const span = time[high] - time[low] || 1;
      const t = (target - time[low]) / span;
      const a = projected[low % n];
      const b = projected[high % n];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    },
  };
}
