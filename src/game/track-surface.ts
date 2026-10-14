import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import type { ProjectedTrack } from './track-projection';

/**
 * The racing surface, rebuilt at high resolution over the supplied circuit.
 *
 * The supplied model draws 5.3 km of road with under six thousand
 * triangles and a smeared texture. This surface is generated from the same
 * projected centreline the cars drive on, so its painted edges are exactly
 * where the car's track limits are, and every vertex takes its height from
 * the model's own tarmac underneath it, so it lies on the circuit rather than
 * floating over or cutting through it.
 *
 * Each vertex carries where it is on the circuit (metres across and along
 * the lap), where the rubbered line runs at that point, and how hard cars
 * brake there. The shader turns those into crisp lines, a darker racing line
 * and braking marks, all sharp at any distance because they are computed,
 * not sampled from a texture.
 */

export interface SurfaceSampler {
  /** Height of the supplied tarmac at (x, z), or null where there is none. */
  heightAt(x: number, z: number, near: number): number | null;
}

/** Triangles of the given meshes, bucketed on a ground grid for fast height queries. */
export function createSurfaceSampler(root: Object3D, materialNames: ReadonlySet<string>, cell = 8): SurfaceSampler {
  root.updateMatrixWorld(true);
  const triangles: number[] = [];
  const vertex = new Vector3();
  const matrix = new Matrix4();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some((material) => materialNames.has(material.name))) return;
    const geometry = object.geometry as BufferGeometry;
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    matrix.copy(object.matrixWorld);
    const count = index ? index.count : position.count;
    for (let corner = 0; corner < count; corner += 1) {
      vertex.fromBufferAttribute(position, index ? index.getX(corner) : corner).applyMatrix4(matrix);
      triangles.push(vertex.x, vertex.y, vertex.z);
    }
  });
  const grid = new Map<number, number[]>();
  const key = (cx: number, cz: number) => cx * 73856093 ^ cz * 19349663;
  const triangleCount = triangles.length / 9;
  for (let t = 0; t < triangleCount; t += 1) {
    const o = t * 9;
    const minX = Math.min(triangles[o], triangles[o + 3], triangles[o + 6]);
    const maxX = Math.max(triangles[o], triangles[o + 3], triangles[o + 6]);
    const minZ = Math.min(triangles[o + 2], triangles[o + 5], triangles[o + 8]);
    const maxZ = Math.max(triangles[o + 2], triangles[o + 5], triangles[o + 8]);
    for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell); cx += 1) {
      for (let cz = Math.floor(minZ / cell); cz <= Math.floor(maxZ / cell); cz += 1) {
        const k = key(cx, cz);
        let bucket = grid.get(k);
        if (!bucket) { bucket = []; grid.set(k, bucket); }
        bucket.push(t);
      }
    }
  }
  return {
    heightAt(x, z, near) {
      const bucket = grid.get(key(Math.floor(x / cell), Math.floor(z / cell)));
      if (!bucket) return null;
      let best: number | null = null;
      for (const t of bucket) {
        const o = t * 9;
        const ax = triangles[o]; const ay = triangles[o + 1]; const az = triangles[o + 2];
        const bx = triangles[o + 3]; const by = triangles[o + 4]; const bz = triangles[o + 5];
        const cx = triangles[o + 6]; const cy = triangles[o + 7]; const cz = triangles[o + 8];
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const w = 1 - u - v;
        if (u < -1e-4 || v < -1e-4 || w < -1e-4) continue;
        const y = u * ay + v * by + w * cy;
        // Several layers can stack (lines over tarmac): take the one nearest the road's own height.
        if (best === null || Math.abs(y - near) < Math.abs(best - near)) best = y;
      }
      return best;
    },
  };
}

/**
 * Where the supplied circuit's kerbs start, per row of the surface, on each
 * side: the track edge the surface stops at so the kerbs show. Rows with no
 * kerb take the default edge (the car's track limit).
 */
export function measureKerbEdges(
  track: ProjectedTrack,
  root: Object3D,
  kerbMaterials: ReadonlySet<string>,
  rows: number,
  fallback: number,
): { left: Float32Array; right: Float32Array; kerbLeft: Uint8Array; kerbRight: Uint8Array } {
  const left = new Float32Array(rows).fill(Infinity);
  const right = new Float32Array(rows).fill(Infinity);
  root.updateMatrixWorld(true);
  const vertex = new Vector3();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some((material) => kerbMaterials.has(material.name))) return;
    const position = (object.geometry as BufferGeometry).getAttribute('position');
    let hint: number | undefined;
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      const projection = track.project(vertex.x, vertex.z, hint);
      hint = projection.fraction;
      const distance = Math.abs(projection.lateral);
      if (distance < 3.5 || distance > 9.5 || Math.abs(vertex.y - projection.point.y) > 1) { hint = undefined; continue; }
      const row = Math.floor(projection.fraction * rows) % rows;
      const target = projection.lateral > 0 ? left : right;
      for (let k = -1; k <= 1; k += 1) {
        const r = (row + k + rows) % rows;
        target[r] = Math.min(target[r], distance);
      }
    }
  });
  const kerbLeft = new Uint8Array(rows);
  const kerbRight = new Uint8Array(rows);
  for (let row = 0; row < rows; row += 1) {
    kerbLeft[row] = Number.isFinite(left[row]) ? 1 : 0;
    kerbRight[row] = Number.isFinite(right[row]) ? 1 : 0;
  }
  // Ease between kerbed and plain rows so the edge never steps.
  const settle = (values: Float32Array) => {
    const raw = Float32Array.from(values, (value) => (Number.isFinite(value) ? Math.min(value, fallback) : fallback));
    for (let row = 0; row < rows; row += 1) {
      let sum = 0;
      let weight = 0;
      for (let k = -4; k <= 4; k += 1) {
        const w = 5 - Math.abs(k);
        sum += raw[(row + k + rows) % rows] * w;
        weight += w;
      }
      values[row] = Math.min(raw[row], sum / weight);
    }
  };
  settle(left);
  settle(right);
  return { left, right, kerbLeft, kerbRight };
}

export interface SurfaceOptions {
  /** Half-width of the generated surface, metres; a little beyond the painted edge. */
  halfWidth: number;
  /** Rows every this many metres along the lap. */
  step: number;
  /** Lateral positions of the columns, metres (left of travel positive). */
  columns: readonly number[];
  /** Raised this far over the supplied tarmac so it always draws on top. */
  lift: number;
}

export const DEFAULT_SURFACE: SurfaceOptions = {
  halfWidth: 7.2,
  step: 1.5,
  // Fractions of the track edge on each side; the ends are the surface's own edge.
  columns: [-2, -1.02, -1, -0.965, -0.91, -0.76, -0.59, -0.4, -0.2, 0, 0.2, 0.4, 0.59, 0.76, 0.91, 0.965, 1, 1.02, 2],
  lift: 0.035,
};

/** Signed curvature of the projected centreline (1/m, positive turning left). */
function curvatureAt(track: ProjectedTrack, fraction: number, span: number): number {
  const ds = span / track.lengthMeters;
  const a = track.at(fraction - ds).tangent;
  const b = track.at(fraction + ds).tangent;
  const turn = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
  return turn / (2 * span);
}

/**
 * Where the rubber goes down: towards the inside of each corner at the apex,
 * eased in and out of it, as a lateral offset in metres. A smoothed
 * curvature over a long window approximates the outside-inside-outside line
 * closely enough to read as the groove cars have worn into the tarmac.
 */
export function rubberLine(track: ProjectedTrack, fraction: number): number {
  const local = curvatureAt(track, fraction, 18);
  const wide = curvatureAt(track, fraction, 70);
  const lead = curvatureAt(track, fraction + 60 / track.lengthMeters, 40);
  // Inside at the apex, drifting outside before turn-in and after exit.
  const offset = (local * 0.55 + wide * 0.45) * 520 - lead * 160;
  return Math.max(-4.6, Math.min(4.6, -offset));
}

/** Builds the surface geometry. `brake` gives braking effort (0..1) at a lap fraction. */
export interface SurfaceEdges {
  left: Float32Array;
  right: Float32Array;
  kerbLeft: Uint8Array;
  kerbRight: Uint8Array;
}

export function surfaceRows(track: ProjectedTrack, options: SurfaceOptions = DEFAULT_SURFACE): number {
  return Math.ceil(track.lengthMeters / options.step);
}

export function buildTrackSurface(
  track: ProjectedTrack,
  sampler: SurfaceSampler | null,
  brake: (fraction: number) => number,
  edges: SurfaceEdges | null,
  options: SurfaceOptions = DEFAULT_SURFACE,
): BufferGeometry {
  const rows = surfaceRows(track, options);
  const columns = options.columns;
  const width = columns.length;
  const positions = new Float32Array(rows * width * 3);
  const track2 = new Float32Array(rows * width * 2);
  const line = new Float32Array(rows * width * 2);
  const edge = new Float32Array(rows * width * 2);
  const indices: number[] = [];
  const heights = new Float32Array(rows * width);
  const limit = track.halfWidth;

  // The surface's own outer edge on each side: up to a kerb where there is
  // one, out to full width where there is not. Shrunk early (a running
  // minimum) and then eased, so it never covers a kerb and never steps.
  const outerEdge = (edgesOf: Float32Array | undefined, kerbs: Uint8Array | undefined) => {
    const raw = new Float32Array(rows);
    for (let row = 0; row < rows; row += 1) {
      const edge = edgesOf ? edgesOf[row] : limit;
      raw[row] = kerbs?.[row] ? edge + 0.02 : Math.max(edge + 0.15, options.halfWidth);
    }
    const shrunk = new Float32Array(rows);
    for (let row = 0; row < rows; row += 1) {
      let low = Infinity;
      for (let k = -4; k <= 4; k += 1) low = Math.min(low, raw[(row + k + rows) % rows]);
      shrunk[row] = low;
    }
    const eased = new Float32Array(rows);
    for (let row = 0; row < rows; row += 1) {
      let sum = 0;
      for (let k = -3; k <= 3; k += 1) sum += shrunk[(row + k + rows) % rows];
      eased[row] = Math.min(raw[row], sum / 7);
    }
    return eased;
  };
  const outerLeft = outerEdge(edges?.left, edges?.kerbLeft);
  const outerRight = outerEdge(edges?.right, edges?.kerbRight);

  for (let row = 0; row < rows; row += 1) {
    const fraction = row / rows;
    const centre = track.at(fraction).point;
    const rubber = rubberLine(track, fraction);
    const braking = brake(fraction);
    const leftEdge = edges ? edges.left[row] : limit;
    const rightEdge = edges ? edges.right[row] : limit;
    // Past the line the surface stops at a kerb, or runs on to its full width.
    const leftOuter = Math.max(leftEdge + 0.01, outerLeft[row]);
    const rightOuter = Math.max(rightEdge + 0.01, outerRight[row]);
    for (let column = 0; column < width; column += 1) {
      const u = columns[column];
      const sideEdge = u >= 0 ? leftEdge : rightEdge;
      const lateral = Math.abs(u) > 1.5 ? Math.sign(u) * (u >= 0 ? leftOuter : rightOuter) : u * sideEdge;
      const { point } = track.at(fraction, lateral);
      const sampled = sampler?.heightAt(point.x, point.z, centre.y);
      // Without supplied tarmac underneath (or a wild sample), stay on the centreline's height.
      const y = sampled !== null && sampled !== undefined && Math.abs(sampled - centre.y) < 1.2 ? sampled : centre.y;
      const index = row * width + column;
      heights[index] = y;
      positions[index * 3] = point.x;
      positions[index * 3 + 2] = point.z;
      track2[index * 2] = lateral;
      track2[index * 2 + 1] = fraction * track.lengthMeters;
      line[index * 2] = Math.max(-0.66 * rightEdge, Math.min(0.66 * leftEdge, rubber));
      line[index * 2 + 1] = braking;
      edge[index * 2] = leftEdge;
      edge[index * 2 + 1] = rightEdge;
    }
  }

  // A light smoothing along the lap removes the supplied mesh's facet steps.
  for (let column = 0; column < width; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      let sum = 0;
      let weight = 0;
      for (let k = -2; k <= 2; k += 1) {
        const w = 3 - Math.abs(k);
        sum += heights[((row + k + rows) % rows) * width + column] * w;
        weight += w;
      }
      positions[(row * width + column) * 3 + 1] = sum / weight + options.lift;
    }
  }

  for (let row = 0; row < rows; row += 1) {
    const next = (row + 1) % rows;
    for (let column = 0; column < width - 1; column += 1) {
      const a = row * width + column;
      const b = row * width + column + 1;
      const c = next * width + column;
      const d = next * width + column + 1;
      // Lateral grows to the left of travel: wind so the surface faces up.
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aTrack', new BufferAttribute(track2, 2));
  geometry.setAttribute('aLine', new BufferAttribute(line, 2));
  geometry.setAttribute('aEdge', new BufferAttribute(edge, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Normals must face up; flip the winding if the lap runs the other way round.
  const normals = geometry.getAttribute('normal');
  let up = 0;
  for (let i = 0; i < normals.count; i += 97) up += normals.getY(i);
  if (up < 0) {
    const index = geometry.getIndex()!;
    const array = index.array as Uint32Array | Uint16Array;
    for (let i = 0; i < array.length; i += 3) { const t = array[i + 1]; array[i + 1] = array[i + 2]; array[i + 2] = t; }
    index.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Painted marks over the surface: a grid box for each starting car, and the
 * chequered timing line across the road at the start of the lap.
 */
export function buildGridMarks(
  track: ProjectedTrack,
  boxes: readonly { distance: number; lateral: number }[],
  sampler: SurfaceSampler | null,
  lift = 0.045,
): BufferGeometry {
  const positions: number[] = [];
  const corner = (fraction: number, lateral: number, along: number) => {
    const f = fraction + along / track.lengthMeters;
    const centre = track.at(f).point;
    const { point } = track.at(f, lateral);
    const sampled = sampler?.heightAt(point.x, point.z, centre.y);
    const y = (sampled !== null && sampled !== undefined && Math.abs(sampled - centre.y) < 1.2 ? sampled : centre.y) + lift;
    return new Vector3(point.x, y, point.z);
  };
  const quad = (fraction: number, lateralA: number, lateralB: number, alongA: number, alongB: number) => {
    const a = corner(fraction, lateralA, alongA);
    const b = corner(fraction, lateralB, alongA);
    const c = corner(fraction, lateralB, alongB);
    const d = corner(fraction, lateralA, alongB);
    // Face up whichever way round the lap and lateral axes turn.
    const up = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).y >= 0;
    const order = up ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    for (const point of order) positions.push(point.x, point.y, point.z);
  };
  for (const box of boxes) {
    // Front bar across the box ahead of the car's nose, and short legs back each side.
    quad(box.distance, box.lateral - 1.45, box.lateral + 1.45, 3.05, 3.2);
    quad(box.distance, box.lateral - 1.45, box.lateral - 1.33, 1.75, 3.2);
    quad(box.distance, box.lateral + 1.33, box.lateral + 1.45, 1.75, 3.2);
  }
  // Chequered timing line: two rows of half-metre squares across the road.
  const square = 0.5;
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 26; column += 1) {
      if ((row + column) % 2 === 1) continue;
      const lateral = -6.5 + column * square;
      quad(0, lateral, lateral + square, row * square, (row + 1) * square);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
