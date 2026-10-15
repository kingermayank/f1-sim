/**
 * Lays out the APEX Shanghai circuit: everything the Blender build needs to
 * place, and everything the game needs to agree with it.
 *
 * It loads the game's own track modules (through Vite, so the TypeScript is
 * the same code the browser runs) and samples the projected centreline every
 * two metres. From that one line it derives:
 *
 * - barrier lines on both sides, kept clear of the other parts of the circuit
 *   and of the pit lane, wide on the outside of fast corners;
 * - run-off surfaces (grass, asphalt, gravel) and kerb runs through corners;
 * - where the grandstands, pit building, gantry, bridges, marshal posts,
 *   billboards and braking boards stand.
 *
 * Writes:
 *   src/track/generated/shanghai-circuit-layout.json  (committed; the game reads the walls and kerbs)
 *   work/track-build/shanghai-layout.json             (regenerable; the Blender build reads it)
 *
 * Usage: node scripts/circuit/export-shanghai-layout.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RUNTIME_OUT = resolve(ROOT, 'src/track/generated/shanghai-circuit-layout.json');
const BUILD_OUT = resolve(ROOT, 'work/track-build/shanghai-layout.json');

const STEP = 2;
const KMH = 3.6;

const server = await createServer({ root: ROOT, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
let SHANGHAI_TRACK;
let createProjectedTrack;
let computeRacingGuide;
let CatmullRomCurve3;
let Vector3;
try {
  ({ SHANGHAI_TRACK } = await server.ssrLoadModule('/src/track/shanghai-track.ts'));
  ({ createProjectedTrack } = await server.ssrLoadModule('/src/game/track-projection.ts'));
  ({ computeRacingGuide } = await server.ssrLoadModule('/src/game/racing-line.ts'));
  ({ CatmullRomCurve3, Vector3 } = await server.ssrLoadModule('three'));
} finally {
  await server.close();
}

const track = createProjectedTrack(SHANGHAI_TRACK);
const N = Math.round(track.lengthMeters / STEP);
const wrap = (index) => ((index % N) + N) % N;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const round = (value, digits = 2) => Number(value.toFixed(digits));

// ---------------------------------------------------------------- samples --
const rows = Array.from({ length: N }, (_, index) => {
  const { point, tangent } = track.at(index / N);
  // Lateral is positive towards (-t.z, t.x), the game's "left".
  return { p: point, t: tangent, n: { x: -tangent.z, z: tangent.x } };
});

const curvature = rows.map((_, index) => {
  const a = rows[wrap(index - 3)].t;
  const b = rows[wrap(index + 3)].t;
  const turn = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
  return turn / (6 * STEP);
});
const guide = computeRacingGuide(track, N);
const speed = guide.map((sample) => sample.speed);

// The pit lane, resampled densely.
const pitCurve = new CatmullRomCurve3(SHANGHAI_TRACK.pitLine.map((p) => new Vector3(p.x, p.y, p.z)), false, 'centripetal');
const pitLength = pitCurve.getLength();
const pitCount = Math.ceil(pitLength / STEP) + 1;
const pit = Array.from({ length: pitCount }, (_, index) => {
  const u = index / (pitCount - 1);
  return { p: pitCurve.getPointAt(u), t: pitCurve.getTangentAt(u) };
});

// Spatial hash of centreline rows for "is there another part of the circuit here?"
const CELL = 24;
const cellKey = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
const grid = new Map();
rows.forEach((row, index) => {
  const key = cellKey(row.p.x, row.p.z);
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push(index);
});
function nearestOther(x, z, self, excludeMetres) {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  let best = Infinity;
  for (let dx = -3; dx <= 3; dx += 1) {
    for (let dz = -3; dz <= 3; dz += 1) {
      for (const index of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
        const along = Math.min(Math.abs(index - self), N - Math.abs(index - self)) * STEP;
        if (along < excludeMetres) continue;
        best = Math.min(best, Math.hypot(rows[index].p.x - x, rows[index].p.z - z));
      }
    }
  }
  return best;
}
const pitGrid = new Map();
pit.forEach((sample, index) => {
  const key = cellKey(sample.p.x, sample.p.z);
  if (!pitGrid.has(key)) pitGrid.set(key, []);
  pitGrid.get(key).push(index);
});
function nearestAny(x, z) {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  let best = Infinity;
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      for (const index of grid.get(`${cx + dx},${cz + dz}`) ?? []) best = Math.min(best, Math.hypot(rows[index].p.x - x, rows[index].p.z - z));
    }
  }
  return best;
}
// Pit samples that have merged into the track (entry and exit) do not get a wall.
const pitSeparated = pit.map((sample) => nearestAny(sample.p.x, sample.p.z) > 13);
function nearestPit(x, z) {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  let best = Infinity;
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      for (const index of pitGrid.get(`${cx + dx},${cz + dz}`) ?? []) {
        if (!pitSeparated[index]) continue;
        best = Math.min(best, Math.hypot(pit[index].p.x - x, pit[index].p.z - z));
      }
    }
  }
  return best;
}

// --------------------------------------------------------------- clearance --
// How far out on each side before reaching another part of the circuit (the
// midline between the two) or the pit lane's own wall line.
const SIDES = [1, -1];
const clearance = { 1: new Float32Array(N), '-1': new Float32Array(N) };
// The pit lane's centre, as a lateral offset from each row, on the side it runs.
const pitLateral = { 1: new Float32Array(N).fill(Infinity), '-1': new Float32Array(N).fill(Infinity) };
{
  let hint;
  for (const sample of pit) {
    const projection = track.project(sample.p.x, sample.p.z, hint);
    hint = projection.fraction;
    const side = Math.sign(projection.lateral) || 1;
    const row = wrap(Math.round(projection.fraction * N));
    for (let k = -1; k <= 1; k += 1) {
      const r = wrap(row + k);
      pitLateral[side][r] = Math.min(pitLateral[side][r], Math.abs(projection.lateral));
    }
  }
}
const PIT_HALF_WIDTH = 4.6;
/**
 * The game holds the car's centre inside the wall line, so a barrier's face
 * stands this much further out: the car's side touches it rather than its
 * centre. The layout's walls are the car-centre limits; Blender adds this.
 */
const BARRIER_STANDOFF = 1.0;
const BARRIER_DEPTH = 1.2;
// The supplied pit polyline wobbles by a couple of metres either way, which a
// pit wall and a row of garages built along it would show. A real pit lane
// runs true alongside its straight, so fit a smooth curve to the polyline and
// ramp it in from the track edge at the entry and back out at the exit.
const PIT_RAMP_ROWS = 30;
const PIT_MERGE_LATERAL = 9;
const smoothPit = [];
for (const side of [1, -1]) {
  const raw = pitLateral[side].slice();
  const covered = (i) => Number.isFinite(raw[i]) && raw[i] <= 40;
  let start = -1;
  for (let i = 0; i < N; i += 1) if (covered(i) && !covered(wrap(i - 1))) { start = i; break; }
  pitLateral[side].fill(Infinity);
  if (start < 0) continue;
  let length = 0;
  while (length < N && covered(wrap(start + length))) length += 1;
  // Least-squares quadratic in the run's own position, 0..1.
  const sums = Array(5).fill(0);
  const rhs = [0, 0, 0];
  for (let k = 0; k < length; k += 1) {
    const t = k / (length - 1);
    const y = raw[wrap(start + k)];
    for (let power = 0; power < 5; power += 1) sums[power] += t ** power;
    for (let power = 0; power < 3; power += 1) rhs[power] += y * t ** power;
  }
  const m = [[sums[0], sums[1], sums[2]], [sums[1], sums[2], sums[3]], [sums[2], sums[3], sums[4]]];
  const det3 = (a) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const det = det3(m);
  const coef = [0, 1, 2].map((column) => det3(m.map((line, r) => line.map((value, c) => (c === column ? rhs[r] : value)))) / det);
  const fitted = (k) => { const t = clamp(k / (length - 1), 0, 1); return coef[0] + coef[1] * t + coef[2] * t * t; };
  for (let k = -PIT_RAMP_ROWS; k < length + PIT_RAMP_ROWS; k += 1) {
    const toEntry = smoothstep(-PIT_RAMP_ROWS, PIT_RAMP_ROWS, k);
    const toExit = smoothstep(-PIT_RAMP_ROWS, PIT_RAMP_ROWS, length - 1 - k);
    const blend = Math.min(toEntry, toExit);
    pitLateral[side][wrap(start + k)] = PIT_MERGE_LATERAL + (fitted(k) - PIT_MERGE_LATERAL) * blend;
    smoothPit.push({ side, row: wrap(start + k) });
  }
}
// The pit wall stands just inside the lane; where the lane merges it opens.
const pitWall = { 1: new Float32Array(N).fill(Infinity), '-1': new Float32Array(N).fill(Infinity) };
const pitOpening = { 1: new Uint8Array(N), '-1': new Uint8Array(N) };
for (const side of [1, -1]) {
  for (let i = 0; i < N; i += 1) {
    const lane = pitLateral[side][i];
    if (!Number.isFinite(lane) || lane > 40) continue;
    const wallAt = lane - PIT_HALF_WIDTH - 0.6 - BARRIER_STANDOFF;
    if (wallAt < 9.5) pitOpening[side][i] = 1;
    else pitWall[side][i] = wallAt;
  }
}
for (let index = 0; index < N; index += 1) {
  const row = rows[index];
  for (const side of SIDES) {
    let clear = 90;
    for (let d = 7.5; d <= 90; d += 0.5) {
      const x = row.p.x + row.n.x * d * side;
      const z = row.p.z + row.n.z * d * side;
      if (nearestOther(x, z, index, 110) <= d) { clear = d; break; }
    }
    clearance[side][index] = clear;
  }
}

// ----------------------------------------------------------------- run-off --
// Exposure of each side to cars running wide: the outside of corners, scaled
// by the speed the car arrives at, spread from turn-in through the exit.
const exposure = { 1: new Float32Array(N), '-1': new Float32Array(N) };
const hairpin = { 1: new Float32Array(N), '-1': new Float32Array(N) };
for (let j = 0; j < N; j += 1) {
  const kappa = curvature[j];
  if (Math.abs(kappa) < 0.0045) continue;
  const outside = -Math.sign(kappa);
  let entry = 0;
  for (let back = 0; back <= 60; back += 1) entry = Math.max(entry, speed[wrap(j - back)]);
  const value = clamp((entry * KMH - 90) / 200, 0, 1);
  const tight = smoothstep(0.018, 0.03, Math.abs(kappa));
  for (let k = -25; k <= 45; k += 1) {
    const fall = k < 0 ? 1 - (-k / 26) ** 2 : 1 - (k / 46) ** 2;
    const i = wrap(j + k);
    exposure[outside][i] = Math.max(exposure[outside][i], value * fall);
    hairpin[outside][i] = Math.max(hairpin[outside][i], tight * fall);
  }
}

function boxFilter(values, radius) {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += values[wrap(i + k)];
    out[i] = sum / (radius * 2 + 1);
  }
  return out;
}
function minFilter(values, radius) {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    let low = Infinity;
    for (let k = -radius; k <= radius; k += 1) low = Math.min(low, values[wrap(i + k)]);
    out[i] = low;
  }
  return out;
}

const BASE_WALL = 12.5;
const MIN_WALL = 9.5;
const wall = {};
const runoff = {};
for (const side of SIDES) {
  // Beside the pit lane the pit wall is the barrier.
  const wanted = Float32Array.from(
    boxFilter(Float32Array.from(exposure[side], (x, i) => BASE_WALL + 27 * Math.max(x, hairpin[side][i] * 0.6) ** 0.8), 10),
    (w, i) => (pitWall[side][i] < 40 ? pitWall[side][i] : pitOpening[side][i] ? MIN_WALL : w),
  );
  const limit = Float32Array.from(wanted, (w, i) => Math.max(MIN_WALL, Math.min(w, clearance[side][i] - BARRIER_STANDOFF - BARRIER_DEPTH - 0.2, pitWall[side][i])));
  // Shrink first, then ease: never past the limit, never a step. The pit
  // wall follows the lane exactly, so it is left as measured.
  const eased = boxFilter(minFilter(limit, 6), 6);
  wall[side] = Float32Array.from(eased, (w, i) => (pitWall[side][i] < 40 || pitOpening[side][i] ? limit[i] : Math.max(MIN_WALL, Math.min(w, limit[i]))));
  runoff[side] = Array.from({ length: N }, (_, i) => {
    if (pitOpening[side][i]) return 'o';
    if (pitWall[side][i] < 40) return 'p';
    if (wall[side][i] < 15) return 'g';
    const fast = exposure[side][i] > 0.6 || hairpin[side][i] > 0.4;
    return exposure[side][i] > 0.15 && !fast ? 'r' : exposure[side][i] > 0.15 ? 'a' : 'g';
  }).join('');
}

// ------------------------------------------------------------------- kerbs --
// Kerbs through every corner: tight at the apex on the inside, longer on the
// outside where the car is let run out at the exit.
const kerb = {};
for (const side of SIDES) {
  const flags = new Uint8Array(N);
  for (let j = 0; j < N; j += 1) {
    const kappa = curvature[j];
    if (Math.abs(kappa) < 0.0055) continue;
    const inside = Math.sign(kappa) === side;
    const [from, to] = inside ? [-8, 8] : [-12, 24];
    for (let k = from; k <= to; k += 1) flags[wrap(j + k)] = 1;
  }
  // Fill short gaps and drop slivers.
  const runs = (value, maxLength) => {
    let i = 0;
    while (i < N) {
      if (flags[i] !== value) { i += 1; continue; }
      let j = i;
      while (j < N && flags[j] === value) j += 1;
      if (j - i <= maxLength && i > 0 && j < N) for (let k = i; k < j; k += 1) flags[k] = 1 - value;
      i = j;
    }
  };
  runs(0, 8);
  runs(1, 5);
  kerb[side] = Array.from(flags).join('');
}

// ----------------------------------------------------------------- corners --
// Local curvature peaks, numbered in lap order: the turn boards.
const corners = [];
for (let i = 0; i < N; i += 1) {
  const k = Math.abs(curvature[i]);
  if (k < 0.006) continue;
  let peak = true;
  for (let d = -20; d <= 20; d += 1) if (Math.abs(curvature[wrap(i + d)]) > k) { peak = false; break; }
  if (peak && !corners.some((corner) => Math.abs(corner.row - i) < 30)) corners.push({ row: i, side: Math.sign(curvature[i]) });
}
corners.sort((a, b) => a.row - b.row);

// ------------------------------------------------------------- placements --
const fraction = (row) => round(wrap(row) / N, 5);
const rowOf = (f) => wrap(Math.round(f * N));
const pitSide = (() => {
  const row = rows[0];
  const sample = pit[Math.floor(pit.length / 2)].p;
  return Math.sign((sample.x - row.p.x) * row.n.x + (sample.z - row.p.z) * row.n.z) || 1;
})();

// Room behind the barrier on a side over a run of rows.
function roomBehind(side, from, to) {
  let room = Infinity;
  for (let i = from; i <= to; i += 1) {
    const row = wrap(i);
    room = Math.min(room, clearance[side][row] - wall[side][row], (pitWall[side][row] ?? Infinity) - wall[side][row]);
  }
  return room;
}

const grandstands = [];
// The main grandstand faces the pit building across the start/finish straight.
// Like Shanghai's, 400 m long, three tiers under one flat cantilevered roof.
grandstands.push({ id: 'main', from: fraction(rowOf(0.958)), to: fraction(rowOf(0.032)), side: -pitSide, setback: 4, depth: 36, tiers: 3, roof: 'flat' });
// Stands H and K face each other over the last 290 m of the back straight,
// under rows of white lotus-leaf umbrellas.
const backStraight = (() => {
  let best = { from: 0, length: 0 };
  let start = null;
  for (let i = 0; i < 2 * N; i += 1) {
    const straight = Math.abs(curvature[wrap(i)]) < 0.0025;
    if (straight && start === null) start = i;
    if (!straight && start !== null) {
      if (start < N && i - start > best.length) best = { from: start, length: i - start };
      start = null;
    }
  }
  return { from: best.from, to: best.from + best.length };
})();
for (const [id, side] of [['H', pitSide], ['K', -pitSide]]) {
  const to = backStraight.to - 6;
  const from = to - 140;
  if (roomBehind(side, from, to) >= 34) {
    grandstands.push({ id, from: fraction(from), to: fraction(to), side, setback: 6, depth: 24, tiers: 2, roof: 'lotus' });
  }
}
// Corner stands on the outside of the corners cars arrive at fastest, where there is room.
const cornerCandidates = corners
  .map((corner, number) => {
    const outside = -corner.side;
    let entry = 0;
    for (let back = 0; back <= 60; back += 1) entry = Math.max(entry, speed[wrap(corner.row - back)]);
    return { ...corner, outside, entry, number: number + 1 };
  })
  .sort((a, b) => b.entry - a.entry);
for (const corner of cornerCandidates) {
  if (grandstands.length >= 9) break;
  const half = 40;
  const from = corner.row - half;
  const to = corner.row + half;
  const room = roomBehind(corner.outside, from, to);
  if (room < 34) continue;
  const f = corner.row / N;
  if (grandstands.some((stand) => {
    const centre = stand.from < stand.to ? (stand.from + stand.to) / 2 : ((stand.from + stand.to + 1) / 2) % 1;
    const gap = Math.min(Math.abs(centre - f), 1 - Math.abs(centre - f)) * track.lengthMeters;
    return gap < 260;
  })) continue;
  grandstands.push({ id: `turn-${corner.number}`, from: fraction(from), to: fraction(to), side: corner.outside, setback: 6, depth: 20, tiers: 2, roof: 'shell' });
}

// Braking boards before the big stops.
const brakingBoards = [];
for (let i = 0; i < N; i += 1) {
  const starts = guide[i].effort >= 0.55 && guide[wrap(i - 1)].effort < 0.55;
  if (!starts || speed[wrap(i - 20)] * KMH < 190) continue;
  if (brakingBoards.some((board) => Math.abs(board.row - i) < 150)) continue;
  // Which way does the corner turn? Boards stand on its outside.
  let turn = 0;
  for (let k = 0; k < 80; k += 1) turn += curvature[wrap(i + k)];
  brakingBoards.push({ row: i, side: -Math.sign(turn) || 1 });
}

// Marshal posts every ~280 m, alternating sides, where there is room.
const marshals = [];
for (let i = 40, side = 1; i < N; i += 140, side = -side) {
  const s = clearance[side][i] - wall[side][i] > 8 ? side : -side;
  if (clearance[s][i] - wall[s][i] > 8) marshals.push({ fraction: fraction(i), side: s });
}

// Billboards facing the approach to corners, behind the outside barrier.
const billboards = corners
  .filter((corner) => roomBehind(-corner.side, corner.row - 30, corner.row - 10) > 22)
  .map((corner, index) => ({ fraction: fraction(corner.row - 20), side: -corner.side, poster: index }));

// Bridges over straights: where the track runs straight for 120 m either way.
const straightAt = (row) => { for (let k = -60; k <= 60; k += 1) if (Math.abs(curvature[wrap(row + k)]) > 0.002) return false; return true; };
const bridges = [];
for (const f of [0.705, 0.31, 0.5, 0.88]) {
  for (let shift = 0; shift < 120; shift += 5) {
    const row = rowOf(f + (shift * STEP) / track.lengthMeters);
    if (straightAt(row)) { bridges.push({ fraction: fraction(row) }); break; }
  }
  if (bridges.length >= 2) break;
}

const zones = SHANGHAI_TRACK.zones.filter((zone) => zone.kind === 'passing').map((zone) => ({ start: zone.start, end: zone.end }));

const runtime = {
  version: 1,
  step: STEP,
  rows: N,
  barrierStandoff: BARRIER_STANDOFF,
  wall: { left: Array.from(wall[1], (v) => round(v, 1)), right: Array.from(wall[-1], (v) => round(v, 1)) },
  kerb: { left: kerb[1], right: kerb[-1] },
  runoff: { left: runoff[1], right: runoff[-1] },
  pitSide,
  gantry: { fraction: 0 },
  grandstands,
  bridges,
};

// The pit lane as built: the fitted lane, every row along the pit side.
const pitPath = smoothPit.filter((entry) => entry.side === pitSide).map(({ row }) => {
  const lane = pitLateral[pitSide][row];
  const r = rows[row];
  return { p: { x: r.p.x + r.n.x * lane * pitSide, y: r.p.y, z: r.p.z + r.n.z * lane * pitSide }, separated: lane > 13 };
});
pitPath.forEach((sample, index) => {
  const a = pitPath[Math.max(0, index - 1)].p;
  const b = pitPath[Math.min(pitPath.length - 1, index + 1)].p;
  const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  sample.t = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
});

const build = {
  ...runtime,
  centre: rows.map((row) => [round(row.p.x), round(row.p.y), round(row.p.z), round(row.t.x, 4), round(row.t.z, 4)]),
  curvature: Array.from(curvature, (k) => round(k, 5)),
  speed: speed.map((v) => round(v, 1)),
  clearance: { left: Array.from(clearance[1], (v) => round(v, 1)), right: Array.from(clearance[-1], (v) => round(v, 1)) },
  pitWall: { left: Array.from(pitWall[1], (v) => (Number.isFinite(v) ? round(v, 1) : null)), right: Array.from(pitWall[-1], (v) => (Number.isFinite(v) ? round(v, 1) : null)) },
  pitLateral: { left: Array.from(pitLateral[1], (v) => (Number.isFinite(v) ? round(v, 1) : null)), right: Array.from(pitLateral[-1], (v) => (Number.isFinite(v) ? round(v, 1) : null)) },
  pit: pitPath.map((sample) => [round(sample.p.x), round(sample.p.y), round(sample.p.z), round(sample.t.x, 4), round(sample.t.z, 4), sample.separated ? 1 : 0]),
  corners: corners.map((corner, index) => ({ number: index + 1, fraction: fraction(corner.row), side: corner.side })),
  brakingBoards: brakingBoards.map((board) => ({ fraction: fraction(board.row), side: board.side })),
  marshals,
  billboards,
  zones,
  gridSlots: SHANGHAI_TRACK.gridSlots,
  sectors: SHANGHAI_TRACK.sectors,
  lengthMeters: track.lengthMeters,
  barrierDepth: BARRIER_DEPTH,
  pitHalfWidth: PIT_HALF_WIDTH,
  halfWidth: track.halfWidth,
  kerbHalfWidth: track.kerbHalfWidth,
};

mkdirSync(dirname(RUNTIME_OUT), { recursive: true });
mkdirSync(dirname(BUILD_OUT), { recursive: true });
writeFileSync(RUNTIME_OUT, `${JSON.stringify(runtime)}\n`);
writeFileSync(BUILD_OUT, JSON.stringify(build));

const count = (text, char) => text.split('').filter((c) => c === char).length;
console.log(`rows ${N}, corners ${corners.length}, grandstands ${grandstands.length}, braking boards ${brakingBoards.length}, marshals ${marshals.length}, billboards ${billboards.length}, bridges ${bridges.length}, pit side ${pitSide}`);
for (const side of SIDES) {
  const name = side > 0 ? 'left' : 'right';
  const w = wall[side];
  console.log(`${name}: wall ${Math.min(...w).toFixed(1)}–${Math.max(...w).toFixed(1)} m, kerb ${(count(kerb[side], '1') * STEP / 1000).toFixed(2)} km, asphalt ${count(runoff[side], 'a')}, gravel ${count(runoff[side], 'r')}, pit wall ${count(runoff[side], 'p')}, pit opening ${count(runoff[side], 'o')}`);
}
