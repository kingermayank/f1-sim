/**
 * Generates `src/track/shanghai-track.ts` from the supplied Shanghai GLB.
 *
 * Nothing here is hand-authored from a picture of the circuit: the centerline is
 * fitted to the model's painted track boundaries, and the start/finish line, the
 * starting grid, the pit lane, pit entry and pit exit are all located from named
 * geometry inside the model. That keeps the authoritative racing surface locked
 * to the mesh the user actually sees.
 *
 * Source space is Z-up-negative; world space is Y-up: (lx, ly, lz) -> (lx, -lz, ly).
 *
 * Run: npm run generate:track
 */
import { writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';

const SOURCE =
  process.argv[2] ?? 'work/assets-source/shanghai/original/source/shanghai_compressed.glb';
const OUT = process.argv[3] ?? 'src/track/shanghai-track.ts';

const REAL_LAP_METRES = 5451; // official Shanghai International Circuit lap distance
const RACE_LAPS = 56; // official Chinese Grand Prix distance
const CENTERLINE_POINTS = 360; // ~15 m spacing; resampled again by CatmullRom at runtime

const STEP = 6;
const DISC = 22;
const HEADING_DAMPING = 0.55;

const io = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.decoder': MeshoptDecoder,
});

const doc = await io.read(SOURCE);
const toWorld = ([lx, ly, lz]) => [lx, -lz, ly];

function primitivesByMaterial(pattern) {
  const found = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? '';
      if (pattern.test(name)) found.push({ name, prim });
    }
  }
  return found;
}

function vertices(prim) {
  const pos = prim.getAttribute('POSITION');
  const out = [];
  for (let i = 0; i < pos.getCount(); i += 1) out.push(toWorld(pos.getElement(i, [])));
  return out;
}

function centroid(points) {
  const sum = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
  return sum.map((v) => v / points.length);
}

// ---------------------------------------------------------------------------
// 1. Fit the centerline to the painted track boundaries.
// ---------------------------------------------------------------------------

const paint = primitivesByMaterial(/^raceline$/).flatMap(({ prim }) => vertices(prim));
if (!paint.length) throw new Error('raceline paint not found');

const CELL = DISC;
const grid = new Map();
const cellKey = (cx, cz) => `${cx},${cz}`;
for (const p of paint) {
  const k = cellKey(Math.floor(p[0] / CELL), Math.floor(p[2] / CELL));
  let bucket = grid.get(k);
  if (!bucket) grid.set(k, (bucket = []));
  bucket.push(p);
}
function near(x, z, radius) {
  const out = [];
  const r = Math.ceil(radius / CELL);
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  for (let i = -r; i <= r; i += 1) {
    for (let j = -r; j <= r; j += 1) {
      for (const p of grid.get(cellKey(cx + i, cz + j)) ?? []) {
        if (Math.hypot(p[0] - x, p[2] - z) <= radius) out.push(p);
      }
    }
  }
  return out;
}

function principalDirection(x, z) {
  const local = near(x, z, DISC);
  const mx = local.reduce((s, p) => s + p[0], 0) / local.length;
  const mz = local.reduce((s, p) => s + p[2], 0) / local.length;
  let xx = 0;
  let xz = 0;
  let zz = 0;
  for (const p of local) {
    const dx = p[0] - mx;
    const dz = p[2] - mz;
    xx += dx * dx;
    xz += dx * dz;
    zz += dz * dz;
  }
  const theta = 0.5 * Math.atan2(2 * xz, xx - zz);
  return [Math.cos(theta), Math.sin(theta)];
}

const cx0 = paint.reduce((s, p) => s + p[0], 0) / paint.length;
const cz0 = paint.reduce((s, p) => s + p[2], 0) / paint.length;
let seed = paint[0];
let seedD = -1;
for (const p of paint) {
  const d = Math.hypot(p[0] - cx0, p[2] - cz0);
  if (d > seedD) {
    seedD = d;
    seed = p;
  }
}

let [hx, hz] = principalDirection(seed[0], seed[2]);
let cursor = [seed[0], seed[1], seed[2]];
const marched = [];
let travelled = 0;
for (let i = 0; i < 4000; i += 1) {
  const disc = near(cursor[0], cursor[2], DISC).filter(
    (p) => (p[0] - cursor[0]) * hx + (p[2] - cursor[2]) * hz > 0,
  );
  if (!disc.length) break;
  const c = centroid(disc);
  let nx = c[0] - cursor[0];
  let nz = c[2] - cursor[2];
  const len = Math.hypot(nx, nz);
  if (len < 1e-6) break;
  nx /= len;
  nz /= len;
  hx = hx * (1 - HEADING_DAMPING) + nx * HEADING_DAMPING;
  hz = hz * (1 - HEADING_DAMPING) + nz * HEADING_DAMPING;
  const hl = Math.hypot(hx, hz);
  hx /= hl;
  hz /= hl;
  cursor = [cursor[0] + hx * STEP, c[1], cursor[2] + hz * STEP];
  marched.push(cursor);
  travelled += STEP;
  if (travelled > REAL_LAP_METRES * 0.5 && Math.hypot(cursor[0] - seed[0], cursor[2] - seed[2]) < STEP * 2) break;
}

const planar = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const loopLength = (pts) => pts.reduce((s, p, i) => s + planar(p, pts[(i + 1) % pts.length]), 0);

function resample(pts, count) {
  const step = loopLength(pts) / count;
  const out = [pts[0]];
  let idx = 0;
  let carry = 0;
  let cur = pts[0];
  while (out.length < count && idx < pts.length * 3) {
    const next = pts[(idx + 1) % pts.length];
    const seg = planar(cur, next);
    if (carry + seg >= step && seg > 1e-9) {
      const t = (step - carry) / seg;
      cur = [
        cur[0] + (next[0] - cur[0]) * t,
        cur[1] + (next[1] - cur[1]) * t,
        cur[2] + (next[2] - cur[2]) * t,
      ];
      out.push(cur);
      carry = 0;
    } else {
      carry += seg;
      cur = next;
      idx += 1;
    }
  }
  return out;
}

function smooth(pts, passes) {
  let cur = pts;
  for (let p = 0; p < passes; p += 1) {
    cur = cur.map((c, i) => {
      const a = cur[(i - 1 + cur.length) % cur.length];
      const b = cur[(i + 1) % cur.length];
      return [c[0] * 0.5 + a[0] * 0.25 + b[0] * 0.25, c[1] * 0.5 + a[1] * 0.25 + b[1] * 0.25, c[2] * 0.5 + a[2] * 0.25 + b[2] * 0.25];
    });
  }
  return cur;
}

let centerline = smooth(resample(marched, CENTERLINE_POINTS), 2);

// ---------------------------------------------------------------------------
// 2. Locate landmarks from named geometry.
// ---------------------------------------------------------------------------

const landmark = (pattern) => {
  const prims = primitivesByMaterial(pattern);
  if (!prims.length) return null;
  return centroid(prims.flatMap(({ prim }) => vertices(prim)));
};

const startFinish = landmark(/^sha_banner_startfinish_a$/);
const gridLines = landmark(/^sha_gridlines_a$/);
const pitEntrance = landmark(/^sha_banner_pitentrance_a$/);
const pitExitLight = landmark(/^lg_pit_exit_light_b/);
const pitLanePoints = primitivesByMaterial(/^Pit_lane$/).flatMap(({ prim }) => vertices(prim));

if (!startFinish || !pitEntrance || !pitExitLight || !pitLanePoints.length) {
  throw new Error('required Shanghai landmarks missing from source model');
}

const nearestIndex = (pts, target) => {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i += 1) {
    const d = planar(pts[i], target);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
};

// 3. Orient the lap: the main straight runs from pit entry towards pit exit, so
// the racing direction at the start/finish line points at the pit exit end.
const startIndex = nearestIndex(centerline, startFinish);
const ahead = centerline[(startIndex + 1) % centerline.length];
const straightDirection = [
  pitExitLight[0] - pitEntrance[0],
  0,
  pitExitLight[2] - pitEntrance[2],
];
const travelDot =
  (ahead[0] - centerline[startIndex][0]) * straightDirection[0] +
  (ahead[2] - centerline[startIndex][2]) * straightDirection[2];

if (travelDot < 0) centerline = centerline.slice().reverse();

// 4. Rotate so index 0 is the start/finish line.
const zeroIndex = nearestIndex(centerline, startFinish);
centerline = [...centerline.slice(zeroIndex), ...centerline.slice(0, zeroIndex)];

const lapMetres = loopLength(centerline);
const fractionOf = (target) => nearestIndex(centerline, target) / centerline.length;

const pitEntryFraction = fractionOf(pitEntrance);
const pitExitFraction = fractionOf(pitExitLight);

// ---------------------------------------------------------------------------
// 5. Pit lane: order the pit surface along the straight, entry -> exit.
// ---------------------------------------------------------------------------

const axis = (() => {
  const dx = pitExitLight[0] - pitEntrance[0];
  const dz = pitExitLight[2] - pitEntrance[2];
  const l = Math.hypot(dx, dz);
  return [dx / l, dz / l];
})();

const projected = pitLanePoints
  .map((p) => ({ p, t: (p[0] - pitEntrance[0]) * axis[0] + (p[2] - pitEntrance[2]) * axis[1] }))
  .sort((a, b) => a.t - b.t);

// Bin along the axis and average each bin so the corridor collapses to a line.
const PIT_BINS = 48;
const minT = projected[0].t;
const maxT = projected[projected.length - 1].t;
const bins = Array.from({ length: PIT_BINS }, () => []);
for (const { p, t } of projected) {
  const b = Math.min(PIT_BINS - 1, Math.floor(((t - minT) / (maxT - minT)) * PIT_BINS));
  bins[b].push(p);
}
const pitLine = bins.filter((b) => b.length).map((b) => centroid(b));

// ---------------------------------------------------------------------------
// 6. Grid slots behind the start/finish line, two-by-two staggered.
// ---------------------------------------------------------------------------

const GRID_CARS = 14;
const GRID_ROW_METRES = 8; // longitudinal gap between rows
const GRID_LATERAL = 3.2; // metres either side of the centerline

const gridSlots = Array.from({ length: GRID_CARS }, (_, index) => {
  const row = Math.floor(index / 2);
  const backMetres = 12 + row * GRID_ROW_METRES;
  return {
    distance: ((1 - backMetres / lapMetres) % 1 + 1) % 1,
    lateral: index % 2 === 0 ? -GRID_LATERAL : GRID_LATERAL,
  };
});

// ---------------------------------------------------------------------------
// 7. Trackside camera anchors at Shanghai's distinctive locations.
// ---------------------------------------------------------------------------

/**
 * Curated shot list. Each entry is a lap fraction measured from the start/finish
 * line plus how the camera should sit relative to the track there. Positions are
 * computed from the fitted spline, so they follow the real circuit rather than
 * hand-typed coordinates.
 */
const CAMERA_SHOTS = [
  { id: 'pit-straight',    distance: 0.015, offset: 34, height: 13, name: 'Pit Straight' },
  { id: 'turn-1-entry',    distance: 0.055, offset: 40, height: 16, name: 'Turn 1 Entry' },
  { id: 'turns-2-3-spiral', distance: 0.10, offset: 46, height: 22, name: 'Turns 2-3 Spiral' },
  { id: 'turn-4-exit',     distance: 0.16,  offset: 34, height: 13, name: 'Turn 4 Exit' },
  { id: 'turn-6',          distance: 0.28,  offset: 32, height: 12, name: 'Turn 6' },
  { id: 'turns-7-8',       distance: 0.38,  offset: 34, height: 14, name: 'Turns 7-8' },
  { id: 'turn-9',          distance: 0.47,  offset: 32, height: 12, name: 'Turn 9' },
  { id: 'turn-11',         distance: 0.56,  offset: 34, height: 13, name: 'Turn 11' },
  { id: 'turn-13-exit',    distance: 0.64,  offset: 38, height: 15, name: 'Turn 13 Exit' },
  { id: 'back-straight',   distance: 0.74,  offset: 44, height: 18, name: 'Back Straight' },
  { id: 'turn-14-hairpin', distance: 0.84,  offset: 40, height: 16, name: 'Turn 14 Hairpin' },
  { id: 'turns-15-16',     distance: 0.93,  offset: 34, height: 13, name: 'Turns 15-16' },
];

const sampleAt = (fraction) => centerline[Math.floor(((fraction % 1) + 1) % 1 * centerline.length) % centerline.length];

const cameraAnchors = CAMERA_SHOTS.map(({ id, distance, offset, height, name }) => {
  const index = Math.floor((((distance % 1) + 1) % 1) * centerline.length) % centerline.length;
  const point = centerline[index];
  const previous = centerline[(index - 4 + centerline.length) % centerline.length];
  const next = centerline[(index + 4) % centerline.length];

  const tx = next[0] - previous[0];
  const tz = next[2] - previous[2];
  const tl = Math.hypot(tx, tz) || 1;
  const nx = -tz / tl;
  const nz = tx / tl;

  // Place the camera on the OUTSIDE of the corner so the cars turn into frame
  // rather than away from it. Curvature sign tells us which side that is.
  const ahead = sampleAt(distance + 0.02);
  const behind = sampleAt(distance - 0.02);
  const curvature = (ahead[0] - 2 * point[0] + behind[0]) * nx + (ahead[2] - 2 * point[2] + behind[2]) * nz;
  const side = curvature > 0 ? -1 : 1;

  return {
    id,
    name,
    distance,
    position: {
      x: point[0] + nx * offset * side,
      y: point[1] + height,
      z: point[2] + nz * offset * side,
    },
    targetOffset: { x: 0, y: 1.2, z: 0 },
  };
});

// ---------------------------------------------------------------------------
// 8. Emit.
// ---------------------------------------------------------------------------

const fixed = (n) => Number(n.toFixed(2));
const pointLiteral = (p) => `{ x: ${fixed(p[0])}, y: ${fixed(p[1])}, z: ${fixed(p[2])} }`;

const chunk = (items, per) => {
  const rows = [];
  for (let i = 0; i < items.length; i += per) rows.push(items.slice(i, i + per).join(' '));
  return rows;
};

const centerLiterals = chunk(centerline.map((p) => `${pointLiteral(p)},`), 2)
  .map((row) => `  ${row}`)
  .join('\n');
const pitLiterals = chunk(pitLine.map((p) => `${pointLiteral(p)},`), 2)
  .map((row) => `  ${row}`)
  .join('\n');

const source = `// GENERATED FILE — do not edit by hand.
// Regenerate with: npm run generate:track
//
// Fitted to work/assets-source/shanghai/original/source/shanghai_compressed.glb.
// The centerline is derived from the model's painted track boundaries; the
// start/finish line, pit entry, pit exit and pit lane are located from named
// geometry inside the same model, so this definition and the rendered mesh
// cannot drift apart.
//
// Fitted lap length: ${lapMetres.toFixed(1)} m (official: ${REAL_LAP_METRES} m).
import type { TrackDefinition, TrackPoint } from './track-types';

export const SHANGHAI_DISPLAY_NAME = 'Shanghai International Circuit';
export const SHANGHAI_SHORT_NAME = 'Shanghai';
export const SHANGHAI_RACE_LAPS = ${RACE_LAPS};

const centerLine: TrackPoint[] = [
${centerLiterals}
];

const pitLine: TrackPoint[] = [
${pitLiterals}
];

/** Offsets the centerline sideways to produce attack and defend racing lines. */
const offsetLine = (amount: number): TrackPoint[] =>
  centerLine.map((point, index) => {
    const previous = centerLine[(index - 1 + centerLine.length) % centerLine.length];
    const next = centerLine[(index + 1) % centerLine.length];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    return { x: point.x - (dz / length) * amount, y: point.y, z: point.z + (dx / length) * amount };
  });

export const SHANGHAI_TRACK: TrackDefinition = {
  id: 'shanghai-2026',
  lengthMeters: ${Math.round(lapMetres)},
  centerLine,
  attackLine: offsetLine(-3.1),
  defendLine: offsetLine(2.6),
  pitLine,
  pitEntry: ${fixed(pitEntryFraction)},
  pitExit: ${fixed(pitExitFraction)},
  sectors: [0.29, 0.63, 1],
  gridSlots: [
${gridSlots.map((s) => `    { distance: ${s.distance.toFixed(4)}, lateral: ${s.lateral} },`).join('\n')}
  ],
  zones: [
    // Both DRS straights: the back straight into the Turn 14 hairpin, and the
    // main straight into Turn 1.
    { start: 0.66, end: 0.83, kind: 'passing' },
    { start: 0.94, end: 0.04, kind: 'passing' },
    { start: 0, end: 1, kind: 'yellow' },
    { start: ${fixed(pitEntryFraction)}, end: ${fixed(pitExitFraction)}, kind: 'speed-limit' },
  ],
  cameraAnchors: [
${cameraAnchors.map((anchor) => `    {\n`
  + `      id: '${anchor.id}',\n`
  + `      name: '${anchor.name}',\n`
  + `      distance: ${anchor.distance},\n`
  + `      position: { x: ${fixed(anchor.position.x)}, y: ${fixed(anchor.position.y)}, z: ${fixed(anchor.position.z)} },\n`
  + `      targetOffset: { x: 0, y: 1.2, z: 0 },\n`
  + `    },`).join('\n')}
  ],
};
`;

writeFileSync(OUT, source);

console.log('fitted lap length (m) :', lapMetres.toFixed(1), `(official ${REAL_LAP_METRES})`);
console.log('delta vs official (%) :', (((lapMetres - REAL_LAP_METRES) / REAL_LAP_METRES) * 100).toFixed(2));
console.log('centerline points     :', centerline.length);
console.log('start/finish world    :', startFinish.map((n) => n.toFixed(1)).join(', '));
console.log('grid lines world      :', gridLines?.map((n) => n.toFixed(1)).join(', '));
console.log('pit entry fraction    :', pitEntryFraction.toFixed(3));
console.log('pit exit fraction     :', pitExitFraction.toFixed(3));
console.log('pit line points       :', pitLine.length);
console.log('wrote                 :', OUT);
