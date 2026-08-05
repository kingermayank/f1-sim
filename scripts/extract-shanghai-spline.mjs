/**
 * Fits the authoritative Shanghai centerline to the source GLB.
 *
 * The GLB's `raceline` material is the painted track boundary on BOTH sides of
 * the circuit (~9.5 km of paint for a 5.45 km lap), so the local centroid of
 * nearby paint is the track centerline. Rather than guessing ribbon topology,
 * this marches a cursor around the loop: at each step it takes the paint within
 * a forward disc, uses its centroid as the next centerline point, and damps the
 * heading so the walk cannot turn back on itself or divert down a branch.
 *
 * The fitted loop length is checked against Shanghai's real 5451 m lap, which
 * validates the fit and confirms the model is authored in metres.
 *
 * Source space is Z-up-negative; world space is Y-up: (lx, ly, lz) -> (lx, -lz, ly).
 */
import { writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';

const SOURCE = process.argv[2];
const OUT = process.argv[3];
const REAL_LAP_METRES = 5451;

const STEP = 6; // metres advanced per march iteration
const DISC = 22; // radius of the forward sampling disc
const HEADING_DAMPING = 0.55; // 0 = ignore new heading, 1 = no damping
const OUTPUT_POINTS = 720;

const io = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.decoder': MeshoptDecoder,
});

const doc = await io.read(SOURCE);

function findPrimitive(materialName) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial()?.getName() === materialName) return prim;
    }
  }
  return null;
}

const prim = findPrimitive('raceline');
if (!prim) throw new Error('raceline primitive not found');

const pos = prim.getAttribute('POSITION');
const points = [];
for (let i = 0; i < pos.getCount(); i += 1) {
  const [lx, ly, lz] = pos.getElement(i, []);
  points.push([lx, -lz, ly]);
}

// Uniform grid so each march step samples a local neighbourhood in constant time.
const CELL = DISC;
const grid = new Map();
const key = (cx, cz) => `${cx},${cz}`;
for (const p of points) {
  const k = key(Math.floor(p[0] / CELL), Math.floor(p[2] / CELL));
  let bucket = grid.get(k);
  if (!bucket) grid.set(k, (bucket = []));
  bucket.push(p);
}
const near = (x, z, radius) => {
  const out = [];
  const r = Math.ceil(radius / CELL);
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  for (let i = -r; i <= r; i += 1) {
    for (let j = -r; j <= r; j += 1) {
      const bucket = grid.get(key(cx + i, cz + j));
      if (!bucket) continue;
      for (const p of bucket) {
        if (Math.hypot(p[0] - x, p[2] - z) <= radius) out.push(p);
      }
    }
  }
  return out;
};

/** Centroid of paint inside a disc, restricted to the forward half-plane. */
function forwardCentroid(x, z, hx, hz) {
  const candidates = near(x, z, DISC);
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  for (const p of candidates) {
    const dx = p[0] - x;
    const dz = p[2] - z;
    if (dx * hx + dz * hz <= 0) continue; // behind the cursor
    sx += p[0];
    sy += p[1];
    sz += p[2];
    n += 1;
  }
  return n ? [sx / n, sy / n, sz / n, n] : null;
}

// Seed on the longest straight so the initial heading is unambiguous: pick the
// paint point furthest from the circuit centroid, then derive heading from PCA.
const cx0 = points.reduce((s, p) => s + p[0], 0) / points.length;
const cz0 = points.reduce((s, p) => s + p[2], 0) / points.length;
let seed = points[0];
let seedD = -1;
for (const p of points) {
  const d = Math.hypot(p[0] - cx0, p[2] - cz0);
  if (d > seedD) {
    seedD = d;
    seed = p;
  }
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
  // Principal eigenvector of the 2x2 covariance matrix.
  const theta = 0.5 * Math.atan2(2 * xz, xx - zz);
  return [Math.cos(theta), Math.sin(theta)];
}

let [hx, hz] = principalDirection(seed[0], seed[2]);
let cursor = [seed[0], seed[1], seed[2]];
const path = [];
let travelled = 0;

for (let iteration = 0; iteration < 4000; iteration += 1) {
  const centroid = forwardCentroid(cursor[0], cursor[2], hx, hz);
  if (!centroid) break;

  let nx = centroid[0] - cursor[0];
  let nz = centroid[2] - cursor[2];
  const len = Math.hypot(nx, nz);
  if (len < 1e-6) break;
  nx /= len;
  nz /= len;

  // Damp the heading so tight corners track smoothly and the walk cannot snap
  // backwards or onto a branch that briefly dominates the disc.
  hx = hx * (1 - HEADING_DAMPING) + nx * HEADING_DAMPING;
  hz = hz * (1 - HEADING_DAMPING) + nz * HEADING_DAMPING;
  const hlen = Math.hypot(hx, hz);
  hx /= hlen;
  hz /= hlen;

  cursor = [cursor[0] + hx * STEP, centroid[1], cursor[2] + hz * STEP];
  path.push(cursor);
  travelled += STEP;

  if (travelled > REAL_LAP_METRES * 0.5 && Math.hypot(cursor[0] - seed[0], cursor[2] - seed[2]) < STEP * 2) {
    break; // closed the loop
  }
}

const planar = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

function loopLength(pts) {
  let total = 0;
  for (let i = 0; i < pts.length; i += 1) total += planar(pts[i], pts[(i + 1) % pts.length]);
  return total;
}

/** Resample the closed loop at uniform arc length. */
function resample(pts, count) {
  const total = loopLength(pts);
  const step = total / count;
  const out = [pts[0]];
  let idx = 0;
  let carry = 0;
  let cursorPoint = pts[0];
  while (out.length < count && idx < pts.length * 3) {
    const next = pts[(idx + 1) % pts.length];
    const seg = planar(cursorPoint, next);
    if (carry + seg >= step && seg > 1e-9) {
      const t = (step - carry) / seg;
      cursorPoint = [
        cursorPoint[0] + (next[0] - cursorPoint[0]) * t,
        cursorPoint[1] + (next[1] - cursorPoint[1]) * t,
        cursorPoint[2] + (next[2] - cursorPoint[2]) * t,
      ];
      out.push(cursorPoint);
      carry = 0;
    } else {
      carry += seg;
      cursorPoint = next;
      idx += 1;
    }
  }
  return out;
}

function smooth(pts, passes) {
  let current = pts;
  for (let p = 0; p < passes; p += 1) {
    current = current.map((cur, i) => {
      const prev = current[(i - 1 + current.length) % current.length];
      const nxt = current[(i + 1) % current.length];
      return [
        cur[0] * 0.5 + prev[0] * 0.25 + nxt[0] * 0.25,
        cur[1] * 0.5 + prev[1] * 0.25 + nxt[1] * 0.25,
        cur[2] * 0.5 + prev[2] * 0.25 + nxt[2] * 0.25,
      ];
    });
  }
  return current;
}

const marchedLength = loopLength(path);
const final = smooth(resample(path, OUTPUT_POINTS), 2);
const finalLength = loopLength(final);
const closure = planar(path[path.length - 1], seed);

console.log('paint points          :', points.length);
console.log('march steps           :', path.length);
console.log('marched length (m)    :', marchedLength.toFixed(1));
console.log('loop closure gap (m)  :', closure.toFixed(2));
console.log('resampled length (m)  :', finalLength.toFixed(1));
console.log('real Shanghai lap (m) :', REAL_LAP_METRES);
console.log('delta vs real (%)     :', (((finalLength - REAL_LAP_METRES) / REAL_LAP_METRES) * 100).toFixed(2));

const bounds = {
  min: [Math.min(...final.map((p) => p[0])), Math.min(...final.map((p) => p[1])), Math.min(...final.map((p) => p[2]))],
  max: [Math.max(...final.map((p) => p[0])), Math.max(...final.map((p) => p[1])), Math.max(...final.map((p) => p[2]))],
};
console.log('spline bounds         :', JSON.stringify(bounds.min.map((n) => n.toFixed(0))), JSON.stringify(bounds.max.map((n) => n.toFixed(0))));

if (OUT) {
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        source: 'shanghai_compressed.glb :: raceline',
        lapLengthMetres: Number(finalLength.toFixed(2)),
        bounds,
        points: final.map((p) => p.map((n) => Number(n.toFixed(3)))),
      },
      null,
      2,
    ),
  );
  console.log('wrote', OUT);
}
