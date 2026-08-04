import type { TrackDefinition, TrackPoint } from './track-types';

const coarse: TrackPoint[] = [
  { x: 0, y: 0, z: 0 }, { x: 26, y: 1, z: -8 }, { x: 48, y: 5, z: -28 },
  { x: 56, y: 10, z: -56 }, { x: 42, y: 16, z: -82 }, { x: 12, y: 20, z: -92 },
  { x: -16, y: 18, z: -80 }, { x: -28, y: 14, z: -54 }, { x: -22, y: 8, z: -30 },
  { x: -44, y: 3, z: -12 }, { x: -70, y: 0, z: 12 }, { x: -58, y: -2, z: 40 },
  { x: -28, y: -2, z: 52 }, { x: 4, y: -1, z: 46 }, { x: 24, y: 0, z: 28 },
  { x: 14, y: 0, z: 12 },
];

function resampleClosed(points: TrackPoint[], count: number): TrackPoint[] {
  const segments = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return Math.hypot(next.x - point.x, next.y - point.y, next.z - point.z);
  });
  const totalLength = segments.reduce((sum, length) => sum + length, 0);

  return Array.from({ length: count }, (_, index) => {
    let remaining = (index / count) * totalLength;
    let segmentIndex = 0;

    while (remaining > segments[segmentIndex] && segmentIndex < segments.length - 1) {
      remaining -= segments[segmentIndex];
      segmentIndex += 1;
    }

    const a = points[segmentIndex];
    const b = points[(segmentIndex + 1) % points.length];
    const t = remaining / segments[segmentIndex];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  });
}

const centerLine = resampleClosed(coarse, 64);
const offsetLine = (amount: number) => centerLine.map((point, index) => {
  const previous = centerLine[(index - 1 + centerLine.length) % centerLine.length];
  const next = centerLine[(index + 1) % centerLine.length];
  const dx = next.x - previous.x;
  const dz = next.z - previous.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: point.x - (dz / length) * amount, y: point.y, z: point.z + (dx / length) * amount };
});

export const MONACO_TRACK: TrackDefinition = {
  id: 'monaco-2026',
  lengthMeters: 3337,
  centerLine,
  attackLine: offsetLine(-1.4),
  defendLine: offsetLine(1.2),
  pitLine: centerLine.slice(58).concat(centerLine.slice(0, 6)).map((point) => ({ ...point, x: point.x + 4 })),
  pitEntry: 0.91,
  pitExit: 0.08,
  sectors: [0.34, 0.66, 1],
  gridSlots: Array.from({ length: 22 }, (_, index) => ({
    distance: (1 - index * 0.0045 + 1) % 1,
    lateral: index % 2 ? 1.2 : -1.2,
  })),
  zones: [
    { start: 0, end: 0.09, kind: 'passing' },
    { start: 0.68, end: 0.78, kind: 'passing' },
    { start: 0, end: 1, kind: 'yellow' },
    { start: 0.91, end: 0.08, kind: 'speed-limit' },
  ],
  cameraAnchors: [0.02, 0.12, 0.24, 0.36, 0.49, 0.63, 0.76, 0.9].map((distance, index) => {
    const point = centerLine[Math.floor(distance * centerLine.length)];
    return {
      id: `camera-${index + 1}`,
      distance,
      position: { x: point.x + 12, y: point.y + 7, z: point.z + 10 },
      targetOffset: { x: 0, y: 0.5, z: 0 },
    };
  }),
};
