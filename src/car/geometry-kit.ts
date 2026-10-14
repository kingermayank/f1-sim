import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Shape,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Small geometry kit the car is drawn with. Every part ends up as plain
 * position + normal + `tone` in the car's own space (metres, nose at +Z, ground
 * at y = 0), so parts of the same material merge into one draw call and the
 * paint shader can read one continuous coordinate system across the whole car.
 *
 * `tone` is a per-vertex mask the paint shader reads: 0 is livery, 1 is the
 * dark trim of openings (cockpit, inlets), so an opening never needs its own
 * mesh or material.
 */

export type Tone = 0 | 1;

/** Monotone cubic interpolation (Fritsch–Carlson): smooth, and it never overshoots between keys. */
export function monotone(keys: readonly number[], values: readonly number[]): (x: number) => number {
  const n = keys.length;
  const slopes: number[] = [];
  const deltas: number[] = [];
  for (let index = 0; index < n - 1; index += 1) {
    deltas.push((values[index + 1] - values[index]) / (keys[index + 1] - keys[index]));
  }
  slopes.push(deltas[0]);
  for (let index = 1; index < n - 1; index += 1) {
    slopes.push(deltas[index - 1] * deltas[index] <= 0 ? 0 : (deltas[index - 1] + deltas[index]) / 2);
  }
  slopes.push(deltas[n - 2]);
  for (let index = 0; index < n - 1; index += 1) {
    if (deltas[index] === 0) { slopes[index] = 0; slopes[index + 1] = 0; continue; }
    const a = slopes[index] / deltas[index];
    const b = slopes[index + 1] / deltas[index];
    const h = Math.hypot(a, b);
    if (h > 3) {
      slopes[index] = (3 / h) * a * deltas[index];
      slopes[index + 1] = (3 / h) * b * deltas[index];
    }
  }
  return (x: number) => {
    if (x <= keys[0]) return values[0];
    if (x >= keys[n - 1]) return values[n - 1];
    let index = 0;
    while (index < n - 2 && x > keys[index + 1]) index += 1;
    const h = keys[index + 1] - keys[index];
    const t = (x - keys[index]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * values[index]
      + (t3 - 2 * t2 + t) * h * slopes[index]
      + (-2 * t3 + 3 * t2) * values[index + 1]
      + (t3 - t2) * h * slopes[index + 1];
  };
}

/** One cross-section of a lofted body: a superellipse with separate top and bottom halves. */
export interface Station {
  /** Position along the car (metres, +Z forward). */
  z: number;
  /** Centre of the section. */
  cx: number;
  cy: number;
  /** Half width. */
  w: number;
  /** Reach above and below the centre. */
  top: number;
  bottom: number;
  /** Superellipse exponents: 2 is an ellipse, larger is boxier. */
  nt: number;
  nb: number;
}

export interface LoftOptions {
  /** Points around each ring. */
  radial: number;
  /** Rings along the body. */
  rings: number;
  /** Collapse the first/last ring to a point so the body closes smoothly. */
  capStart?: 'point' | 'flat' | 'none';
  capEnd?: 'point' | 'flat' | 'none';
  /** Tone of a flat cap (1 makes it a dark opening). */
  capStartTone?: Tone;
  capEndTone?: Tone;
  /** Push a flat cap inward by this many metres, so an opening reads as a recess. */
  capStartDepth?: number;
  capEndDepth?: number;
  /** Optional per-vertex deformation; returns the tone for that vertex. */
  deform?(point: Vector3, theta: number, z: number): Tone | void;
}

const signedPow = (value: number, exponent: number) => Math.sign(value) * Math.abs(value) ** exponent;

/**
 * Lofts a smooth closed body through key stations, sampling every parameter
 * with monotone cubics so bulges never appear between keys. Rings share their
 * seam vertex, so normals are smooth all the way round.
 */
export function loft(stations: readonly Station[], options: LoftOptions): BufferGeometry {
  const sorted = [...stations].sort((a, b) => a.z - b.z);
  const keys = sorted.map((station) => station.z);
  const field = (name: keyof Station) => monotone(keys, sorted.map((station) => station[name]));
  const cx = field('cx');
  const cy = field('cy');
  const w = field('w');
  const top = field('top');
  const bottom = field('bottom');
  const nt = field('nt');
  const nb = field('nb');

  const { radial, rings } = options;
  const positions: number[] = [];
  const tones: number[] = [];
  const indices: number[] = [];
  const point = new Vector3();
  const start = keys[0];
  const end = keys[keys.length - 1];

  // Rings bunch towards the ends, where the shape changes fastest.
  const zAt = (index: number) => {
    const u = index / (rings - 1);
    const eased = 0.5 - 0.5 * Math.cos(Math.PI * u);
    return start + (end - start) * (0.35 * u + 0.65 * eased);
  };

  for (let ring = 0; ring < rings; ring += 1) {
    const z = zAt(ring);
    const sx = w(z);
    const sTop = top(z);
    const sBottom = bottom(z);
    const eTop = 2 / nt(z);
    const eBottom = 2 / nb(z);
    for (let step = 0; step < radial; step += 1) {
      const theta = (step / radial) * Math.PI * 2;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const upper = s >= 0;
      const exponent = upper ? eTop : eBottom;
      point.set(
        cx(z) + sx * signedPow(c, exponent),
        cy(z) + (upper ? sTop : sBottom) * signedPow(s, exponent),
        z,
      );
      const tone = options.deform?.(point, theta, z) ?? 0;
      positions.push(point.x, point.y, point.z);
      tones.push(tone);
    }
  }

  for (let ring = 0; ring < rings - 1; ring += 1) {
    for (let step = 0; step < radial; step += 1) {
      const a = ring * radial + step;
      const b = ring * radial + ((step + 1) % radial);
      const c = (ring + 1) * radial + step;
      const d = (ring + 1) * radial + ((step + 1) % radial);
      // Wound so the outside faces outward with z increasing along the rings.
      indices.push(a, b, c, b, d, c);
    }
  }

  const cap = (ring: number, mode: 'point' | 'flat' | 'none' | undefined, tone: Tone, depth: number, forward: boolean) => {
    if (!mode || mode === 'none') return;
    const z = ring === 0 ? start : end;
    const outward = forward ? 1 : -1;
    const centre = positions.length / 3;
    const tip = mode === 'point' ? Math.min(0.06, w(z) * 0.6) : -depth;
    positions.push(cx(z), cy(z), z + outward * tip);
    tones.push(tone);
    const base = ring * radial;
    if (mode === 'flat' && tone === 1) {
      // A dark cap gets its own rim so the livery does not bleed across it.
      const rim = positions.length / 3;
      for (let step = 0; step < radial; step += 1) {
        const index = base + step;
        positions.push(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
        tones.push(tone);
      }
      for (let step = 0; step < radial; step += 1) {
        const a = rim + step;
        const b = rim + ((step + 1) % radial);
        if (forward) indices.push(centre, a, b); else indices.push(centre, b, a);
      }
      return;
    }
    for (let step = 0; step < radial; step += 1) {
      const a = base + step;
      const b = base + ((step + 1) % radial);
      if (forward) indices.push(centre, a, b); else indices.push(centre, b, a);
    }
  };
  cap(rings - 1, options.capEnd ?? 'point', options.capEndTone ?? 0, options.capEndDepth ?? 0, true);
  cap(0, options.capStart ?? 'point', options.capStartTone ?? 0, options.capStartDepth ?? 0, false);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('tone', new Float32BufferAttribute(tones, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Mirrors a geometry across x = 0, re-winding so it still faces outward. */
export function mirrorX(geometry: BufferGeometry): BufferGeometry {
  const mirrored = geometry.clone();
  mirrored.applyMatrix4(new Matrix4().makeScale(-1, 1, 1));
  const index = mirrored.getIndex();
  if (index) {
    const array = index.array as Uint16Array | Uint32Array;
    for (let face = 0; face < array.length; face += 3) {
      const swap = array[face + 1];
      array[face + 1] = array[face + 2];
      array[face + 2] = swap;
    }
    index.needsUpdate = true;
  }
  mirrored.computeVertexNormals();
  return mirrored;
}

/** Both sides of a part drawn on the left (+X). */
export function bothSides(geometry: BufferGeometry): BufferGeometry[] {
  return [geometry, mirrorX(geometry)];
}

/**
 * Cambered aerofoil, NACA four-digit style, in chord units. The camber is
 * inverted (sagging) because a racing wing presses down rather than lifts.
 */
function aerofoil(samples: number, camber = 0.06, camberAt = 0.4, thickness = 0.1): Vector2[] {
  const upper: Vector2[] = [];
  const lower: Vector2[] = [];
  for (let index = 0; index <= samples; index += 1) {
    // Cosine spacing packs points at the rounded leading edge.
    const u = 0.5 - 0.5 * Math.cos((index / samples) * Math.PI);
    const half = 5 * thickness * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
    const line = u < camberAt
      ? (camber / camberAt ** 2) * (2 * camberAt * u - u * u)
      : (camber / (1 - camberAt) ** 2) * (1 - 2 * camberAt + 2 * camberAt * u - u * u);
    upper.push(new Vector2(u, -line + half));
    lower.push(new Vector2(u, -line - half));
  }
  // Closed loop: along the upper surface to the trailing edge, back along the lower.
  return [...upper, ...lower.reverse().slice(1, -1)];
}

export interface WingSpec {
  /** Span stations, left to right. */
  span: readonly number[];
  /** At each span station: leading-edge z and y, chord, and pitch (radians, trailing edge up). */
  lead: readonly number[];
  height: readonly number[];
  chord: readonly number[];
  pitch: readonly number[];
  thickness?: number;
  camber?: number;
  samples?: number;
  spanSegments?: number;
}

/** A wing element lofted across its span through cambered aerofoil sections. */
export function wing(spec: WingSpec): BufferGeometry {
  const profile = aerofoil(spec.samples ?? 12, spec.camber ?? 0.07, 0.4, spec.thickness ?? 0.1);
  const lead = monotone(spec.span, spec.lead);
  const height = monotone(spec.span, spec.height);
  const chord = monotone(spec.span, spec.chord);
  const pitch = monotone(spec.span, spec.pitch);
  const segments = spec.spanSegments ?? 24;
  const positions: number[] = [];
  const indices: number[] = [];
  const count = profile.length;
  const x0 = spec.span[0];
  const x1 = spec.span[spec.span.length - 1];
  for (let step = 0; step <= segments; step += 1) {
    const x = x0 + ((x1 - x0) * step) / segments;
    const c = chord(x);
    const a = pitch(x);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    for (const point of profile) {
      // Chord runs backwards (-Z) from the leading edge and climbs with pitch.
      const u = point.x * c;
      const v = point.y * c;
      positions.push(x, height(x) + u * sin + v * cos, lead(x) - u * cos + v * sin);
    }
  }
  for (let step = 0; step < segments; step += 1) {
    for (let index = 0; index < count; index += 1) {
      const a = step * count + index;
      const b = step * count + ((index + 1) % count);
      const c = (step + 1) * count + index;
      const d = (step + 1) * count + ((index + 1) % count);
      indices.push(a, c, b, b, c, d);
    }
  }
  // End caps as fans from the section centroid.
  for (const ring of [0, segments]) {
    const centre = positions.length / 3;
    let sx = 0; let sy = 0; let sz = 0;
    for (let index = 0; index < count; index += 1) {
      const offset = (ring * count + index) * 3;
      sx += positions[offset]; sy += positions[offset + 1]; sz += positions[offset + 2];
    }
    positions.push(sx / count, sy / count, sz / count);
    for (let index = 0; index < count; index += 1) {
      const a = ring * count + index;
      const b = ring * count + ((index + 1) % count);
      if (ring === 0) indices.push(centre, a, b); else indices.push(centre, b, a);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return withTone(geometry, 0);
}

/**
 * A flat plate cut from an outline in the car's side (Z, Y) plane and given
 * a little thickness across X: endplates, fins, the rear-wing pylon.
 */
export function sidePlate(outline: readonly [number, number][], x: number, thickness: number, bevel = 0.004): BufferGeometry {
  const shape = new Shape(outline.map(([z, y]) => new Vector2(z, y)));
  const geometry = new ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 16,
  });
  // Shape X is the car's Z, shape Y its height, extrusion runs across -X.
  // A rotation, not a reflection, so the triangles keep facing outward.
  geometry.applyMatrix4(new Matrix4().set(
    0, 0, -1, 0,
    0, 1, 0, 0,
    1, 0, 0, 0,
    0, 0, 0, 1,
  ));
  geometry.translate(x + thickness / 2, 0, 0);
  return finish(geometry, 0);
}

/** A flat plate cut from an outline in the car's plan (X, Z) and given thickness upward: the floor. */
export function planPlate(outline: readonly [number, number][], y: number, thickness: number, bevel = 0.006): BufferGeometry {
  const shape = new Shape(outline.map(([x, z]) => new Vector2(x, -z)));
  const geometry = new ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 12,
  });
  // Shape (x, -z) lies in the ground plane; extrusion climbs in Y. A
  // rotation, not a reflection, so the triangles keep facing outward.
  geometry.applyMatrix4(new Matrix4().set(
    1, 0, 0, 0,
    0, 0, 1, 0,
    0, -1, 0, 0,
    0, 0, 0, 1,
  ));
  geometry.translate(0, y, 0);
  return finish(geometry, 0);
}

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);

/**
 * A streamlined strut between two points: an elliptical tube whose wide face
 * lies along the airflow, like a wishbone or a pushrod.
 */
export function strut(from: Vector3, to: Vector3, wide = 0.034, thin = 0.013, segments = 10): BufferGeometry {
  const direction = to.clone().sub(from);
  const length = direction.length();
  direction.normalize();
  const geometry = new CylinderGeometry(1, 1, length, segments, 1, false);
  geometry.scale(wide / 2, 1, thin / 2);
  // Basis: Y along the strut; the wide face lies flat, across the strut.
  const wideAxis = new Vector3().crossVectors(direction, UP);
  if (wideAxis.lengthSq() < 1e-4) wideAxis.crossVectors(direction, FORWARD);
  wideAxis.normalize();
  const thinAxis = new Vector3().crossVectors(wideAxis, direction).normalize();
  const basis = new Matrix4().makeBasis(wideAxis, direction, thinAxis);
  geometry.applyMatrix4(basis);
  const middle = from.clone().add(to).multiplyScalar(0.5);
  geometry.translate(middle.x, middle.y, middle.z);
  return finish(geometry, 0);
}

/** A tube following a smooth path through points, e.g. the halo. */
export function pathTube(points: readonly Vector3[], radius: (u: number) => number, radial = 14, segments = 64, squash = 1): BufferGeometry {
  const curvePoints = points.map((point) => point.clone());
  const positions: number[] = [];
  const indices: number[] = [];
  // Catmull-Rom sample of the path.
  const sample = (u: number) => {
    const scaled = u * (curvePoints.length - 1);
    const index = Math.min(curvePoints.length - 2, Math.floor(scaled));
    const t = scaled - index;
    const p0 = curvePoints[Math.max(0, index - 1)];
    const p1 = curvePoints[index];
    const p2 = curvePoints[index + 1];
    const p3 = curvePoints[Math.min(curvePoints.length - 1, index + 2)];
    const t2 = t * t;
    const t3 = t2 * t;
    return new Vector3(
      0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
    );
  };
  let previousNormal = new Vector3(0, 1, 0);
  for (let step = 0; step <= segments; step += 1) {
    const u = step / segments;
    const centre = sample(u);
    const ahead = sample(Math.min(1, u + 0.001));
    const behind = sample(Math.max(0, u - 0.001));
    const tangent = ahead.sub(behind).normalize();
    // Parallel transport keeps the ring from twisting.
    const normal = previousNormal.clone().sub(tangent.clone().multiplyScalar(previousNormal.dot(tangent))).normalize();
    previousNormal = normal;
    const binormal = new Vector3().crossVectors(tangent, normal);
    const r = radius(u);
    for (let index = 0; index < radial; index += 1) {
      const angle = (index / radial) * Math.PI * 2;
      const offset = normal.clone().multiplyScalar(Math.cos(angle) * r * squash).addScaledVector(binormal, Math.sin(angle) * r);
      positions.push(centre.x + offset.x, centre.y + offset.y, centre.z + offset.z);
    }
  }
  for (let step = 0; step < segments; step += 1) {
    for (let index = 0; index < radial; index += 1) {
      const a = step * radial + index;
      const b = step * radial + ((index + 1) % radial);
      const c = (step + 1) * radial + index;
      const d = (step + 1) * radial + ((index + 1) % radial);
      indices.push(a, b, c, b, d, c);
    }
  }
  for (const [ring, flip] of [[0, true], [segments, false]] as const) {
    const centre = positions.length / 3;
    const p = sample(ring / segments);
    positions.push(p.x, p.y, p.z);
    for (let index = 0; index < radial; index += 1) {
      const a = ring * radial + index;
      const b = ring * radial + ((index + 1) % radial);
      if (flip) indices.push(centre, b, a); else indices.push(centre, a, b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return withTone(geometry, 0);
}

/** Adds a constant tone attribute. */
export function withTone(geometry: BufferGeometry, tone: Tone): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('tone', new BufferAttribute(new Float32Array(count).fill(tone), 1));
  return geometry;
}

/**
 * Normalises a primitive from three.js (which carries uv and sometimes a
 * non-indexed layout) to the attribute set every car part shares.
 */
export function finish(geometry: BufferGeometry, tone: Tone = 0): BufferGeometry {
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
  }
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  return withTone(geometry, tone);
}

/** Merges parts that share a material; every input must come from this kit. */
export function merge(parts: readonly BufferGeometry[]): BufferGeometry {
  const prepared = parts.map((part) => (part.index ? part : indexed(part)));
  const merged = mergeGeometries(prepared, false);
  if (!merged) throw new Error('Car parts could not be merged: mismatched attributes.');
  for (const part of parts) part.dispose();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function indexed(geometry: BufferGeometry): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const index = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) index[i] = i;
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

/** Applies a translation/rotation to a part in place and returns it. */
export function place(geometry: BufferGeometry, position: Vector3, rotation?: Quaternion): BufferGeometry {
  const matrix = new Matrix4().compose(position, rotation ?? new Quaternion(), new Vector3(1, 1, 1));
  geometry.applyMatrix4(matrix);
  return geometry;
}
