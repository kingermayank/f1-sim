import { BoxGeometry, BufferGeometry, CylinderGeometry, LatheGeometry, SphereGeometry, Vector2, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  bothSides,
  finish,
  loft,
  merge,
  mirrorX,
  monotone,
  pathTube,
  place,
  planPlate,
  sidePlate,
  strut,
  wing,
  type Station,
  type Tone,
} from './geometry-kit';

/**
 * The car, drawn in code to the 2026 single-seater rules: a 3.4 m
 * wheelbase, 1.9 m across, 18-inch wheels on narrower tyres, a halo over the
 * cockpit, and front and rear wings whose flaps can lie flat for the straights.
 *
 * Car space: metres, nose towards +Z, +Y up, the ground at y = 0, the middle
 * of the wheelbase at the origin. Parts are merged by material so one car is
 * about a dozen draw calls, and the geometry is built once per detail level
 * and shared by every car on track: only the paint differs between them.
 */

export type CarDetail = 'high' | 'low';

export const CAR_DIMENSIONS = {
  wheelbase: 3.4,
  frontAxleZ: 1.7,
  rearAxleZ: -1.7,
  tyreRadius: 0.36,
  frontTrack: 0.8,
  rearTrack: 0.765,
  frontTyreHalfWidth: 0.14,
  rearTyreHalfWidth: 0.1875,
  length: 5.44,
} as const;

export interface WheelGeometry {
  tyre: BufferGeometry;
  rim: BufferGeometry;
  brake: BufferGeometry;
  nut: BufferGeometry;
  halfWidth: number;
}

export interface CarGeometry {
  /** Livery surfaces. `tone` marks dark openings (1) and the camera pod (2). */
  paint: BufferGeometry;
  /** Bare carbon: floor, diffuser, wing elements, suspension. */
  carbon: BufferGeometry;
  /** The rear-wing top flap, which pivots flat in straight mode. */
  rearFlap: BufferGeometry;
  /** Pivot of the rear flap: its leading edge, in car space. */
  rearFlapPivot: Vector3;
  /** Front-wing upper flaps, which also ease off in straight mode. */
  frontFlaps: BufferGeometry;
  frontFlapPivot: Vector3;
  helmet: BufferGeometry;
  visor: BufferGeometry;
  /** Mirror glass. */
  chrome: BufferGeometry;
  /** Rain lights. */
  lights: BufferGeometry;
  front: WheelGeometry;
  rear: WheelGeometry;
  /** Wheel centres, left then right; front pair first. */
  wheelCentres: readonly Vector3[];
}

interface Resolution {
  bodyRadial: number;
  bodyRings: number;
  podRadial: number;
  podRings: number;
  smallRadial: number;
  smallRings: number;
  wingSpan: number;
  wingSamples: number;
  wheelSegments: number;
  tubeSegments: number;
}

const RESOLUTION: Record<CarDetail, Resolution> = {
  high: { bodyRadial: 72, bodyRings: 150, podRadial: 48, podRings: 96, smallRadial: 32, smallRings: 48, wingSpan: 44, wingSamples: 14, wheelSegments: 72, tubeSegments: 96 },
  low: { bodyRadial: 22, bodyRings: 36, podRadial: 16, podRings: 22, smallRadial: 12, smallRings: 14, wingSpan: 10, wingSamples: 6, wheelSegments: 20, tubeSegments: 20 },
};

const s = (z: number, cy: number, w: number, top: number, bottom: number, nt: number, nb: number, cx = 0): Station => ({ z, cx, cy, w, top, bottom, nt, nb });

/** Monocoque, nose and engine cover: one loft from the nose tip to the gearbox. */
const BODY: Station[] = [
  s(2.66, 0.150, 0.030, 0.028, 0.028, 2.2, 2.2),
  s(2.55, 0.165, 0.075, 0.055, 0.050, 2.4, 2.4),
  s(2.30, 0.205, 0.115, 0.080, 0.070, 2.6, 2.6),
  s(2.00, 0.262, 0.140, 0.105, 0.088, 2.8, 2.6),
  s(1.65, 0.330, 0.165, 0.132, 0.122, 3.0, 2.8),
  s(1.25, 0.395, 0.205, 0.172, 0.205, 3.2, 3.2),
  s(0.85, 0.405, 0.262, 0.215, 0.300, 3.4, 4.0),
  s(0.45, 0.400, 0.330, 0.265, 0.320, 3.6, 5.0),
  s(0.05, 0.400, 0.360, 0.276, 0.322, 3.6, 5.0),
  s(-0.35, 0.410, 0.350, 0.290, 0.330, 3.4, 5.0),
  s(-0.75, 0.400, 0.290, 0.252, 0.322, 3.0, 4.6),
  s(-1.15, 0.385, 0.215, 0.192, 0.300, 2.8, 4.0),
  s(-1.55, 0.360, 0.140, 0.136, 0.262, 2.6, 3.4),
  s(-1.90, 0.330, 0.100, 0.092, 0.202, 2.4, 3.0),
];

/** Sidepod, left side; the right is its mirror. The front ring is the inlet. */
const SIDEPOD: Station[] = [
  s(0.66, 0.448, 0.118, 0.112, 0.128, 4.6, 4.6, 0.474),
  s(0.52, 0.420, 0.165, 0.160, 0.355, 3.4, 5.0, 0.495),
  s(0.20, 0.400, 0.205, 0.192, 0.335, 3.2, 5.0, 0.505),
  s(-0.30, 0.345, 0.200, 0.160, 0.280, 3.0, 4.5, 0.470),
  s(-0.80, 0.300, 0.155, 0.116, 0.235, 2.8, 4.0, 0.390),
  s(-1.25, 0.270, 0.085, 0.076, 0.205, 2.6, 3.5, 0.290),
  s(-1.45, 0.260, 0.050, 0.050, 0.195, 2.4, 3.0, 0.240),
];

/** The roll-hoop intake above the driver's head, running down into the engine cover. */
const AIRBOX: Station[] = [
  s(-0.24, 0.905, 0.085, 0.075, 0.085, 3.0, 3.0),
  s(-0.34, 0.900, 0.110, 0.105, 0.200, 3.0, 3.0),
  s(-0.60, 0.800, 0.125, 0.085, 0.200, 2.8, 3.0),
  s(-1.00, 0.640, 0.110, 0.060, 0.180, 2.6, 3.0),
  s(-1.45, 0.500, 0.070, 0.040, 0.120, 2.4, 3.0),
];

/** Rear crash structure behind the gearbox, carrying the rain light. */
const CRASH: Station[] = [
  s(-1.86, 0.300, 0.078, 0.072, 0.074, 2.6, 2.6),
  s(-2.20, 0.300, 0.064, 0.060, 0.062, 2.6, 2.6),
  s(-2.42, 0.300, 0.054, 0.050, 0.052, 2.8, 2.8),
];

/** Cockpit opening in plan: a rounded rectangle the loft is pressed into. */
const COCKPIT = { centreZ: 0.12, halfLength: 0.37, halfWidth: 0.235, seat: 0.43 };

function cockpitWell(point: Vector3): Tone {
  if (point.z < COCKPIT.centreZ - COCKPIT.halfLength - 0.02 || point.z > COCKPIT.centreZ + COCKPIT.halfLength + 0.02) return 0;
  if (point.y < 0.5) return 0;
  const q = (Math.abs(point.x) / COCKPIT.halfWidth) ** 3 + (Math.abs(point.z - COCKPIT.centreZ) / COCKPIT.halfLength) ** 3;
  // 1 well inside the opening, easing to 0 across the rim.
  const inside = Math.min(1, Math.max(0, (1.02 - q) / 0.34));
  if (inside <= 0) return 0;
  const eased = inside * inside * (3 - 2 * inside);
  point.y += (COCKPIT.seat - point.y) * eased;
  return eased > 0.12 ? 1 : 0;
}

function body(r: Resolution): BufferGeometry {
  return loft(BODY, {
    radial: r.bodyRadial,
    rings: r.bodyRings,
    capStart: 'point',
    capEnd: 'point',
    deform: (point) => cockpitWell(point),
  });
}

function sidepods(r: Resolution): BufferGeometry[] {
  const left = loft(SIDEPOD, {
    radial: r.podRadial,
    rings: r.podRings,
    capStart: 'point',
    capEnd: 'flat',
    capEndTone: 1,
    capEndDepth: 0.12,
  });
  return bothSides(left);
}

function airbox(r: Resolution): BufferGeometry {
  return loft(AIRBOX, {
    radial: r.smallRadial,
    rings: r.smallRings,
    capStart: 'point',
    capEnd: 'flat',
    capEndTone: 1,
    capEndDepth: 0.14,
  });
}

function sharkFin(): BufferGeometry {
  return sidePlate([
    [-0.62, 0.84], [-0.74, 0.885], [-1.5, 0.66], [-1.66, 0.54], [-1.5, 0.5], [-0.95, 0.66],
  ], 0, 0.009, 0.003);
}

/** Top-surface height of the body loft at (x, z), from the same stations the loft uses. */
const bodyField = (() => {
  const keys = BODY.map((station) => station.z).reverse();
  const pick = (name: keyof Station) => monotone(keys, BODY.map((station) => station[name]).reverse());
  return { cy: pick('cy'), w: pick('w'), top: pick('top'), nt: pick('nt') };
})();

function bodyTop(x: number, z: number): number {
  const w = bodyField.w(z);
  const n = bodyField.nt(z);
  const u = Math.min(1, Math.abs(x) / w);
  return bodyField.cy(z) + bodyField.top(z) * (1 - u ** n) ** (1 / n);
}

/** A padded lip around the cockpit opening, following the body surface. */
function cockpitRim(r: Resolution): BufferGeometry {
  const points: Vector3[] = [];
  const count = 48;
  for (let index = 0; index <= count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    // Superellipse outline matching the well, a touch outside its edge.
    const x = Math.sign(c) * Math.abs(c) ** (2 / 3) * (COCKPIT.halfWidth + 0.012);
    const z = COCKPIT.centreZ + Math.sign(sn) * Math.abs(sn) ** (2 / 3) * (COCKPIT.halfLength + 0.012);
    points.push(new Vector3(x, bodyTop(x, z) - 0.004, z));
  }
  return pathTube(points, () => 0.019, Math.max(8, r.smallRadial / 3), r.tubeSegments);
}

function halo(r: Resolution): BufferGeometry[] {
  const hoop = [
    new Vector3(0.300, 0.66, -0.30),
    new Vector3(0.306, 0.80, -0.19),
    new Vector3(0.292, 0.895, -0.02),
    new Vector3(0.215, 0.936, 0.15),
    new Vector3(0, 0.951, 0.25),
    new Vector3(-0.215, 0.936, 0.15),
    new Vector3(-0.292, 0.895, -0.02),
    new Vector3(-0.306, 0.80, -0.19),
    new Vector3(-0.300, 0.66, -0.30),
  ];
  const pillar = [
    new Vector3(0, 0.951, 0.25),
    new Vector3(0, 0.905, 0.335),
    new Vector3(0, 0.80, 0.415),
    new Vector3(0, 0.665, 0.47),
  ];
  return [
    pathTube(hoop, (u) => 0.026 + 0.005 * Math.abs(u - 0.5) * 2, r.smallRadial / 2, r.tubeSegments),
    pathTube(pillar, (u) => 0.03 + 0.012 * u, r.smallRadial / 2, Math.max(8, r.tubeSegments / 4)),
  ];
}

function mirrors(r: Resolution): { housings: BufferGeometry[]; glass: BufferGeometry[]; stalks: BufferGeometry[] } {
  const housing = finish(new RoundedBoxGeometry(0.17, 0.064, 0.06, r === RESOLUTION.high ? 3 : 1, 0.022));
  place(housing, new Vector3(0.445, 0.712, 0.5));
  const glass = finish(new BoxGeometry(0.148, 0.046, 0.006));
  place(glass, new Vector3(0.445, 0.712, 0.468));
  const stalk = strut(new Vector3(0.335, 0.63, 0.52), new Vector3(0.43, 0.70, 0.5), 0.03, 0.012, 8);
  return { housings: bothSides(housing), glass: bothSides(glass), stalks: bothSides(stalk) };
}

function cameraPod(): BufferGeometry {
  const pod = finish(new RoundedBoxGeometry(0.16, 0.034, 0.055, 2, 0.012), 0);
  place(pod, new Vector3(0, 1.028, -0.37));
  // Tone 2: the shader paints it the driver's camera colour.
  pod.getAttribute('tone').array.fill(2);
  return pod;
}

const FRONT_SPAN = [-0.88, -0.62, -0.28, 0, 0.28, 0.62, 0.88];
const sym = (values: number[]) => [...values, ...values.slice(0, -1).reverse()];

function frontWing(r: Resolution): { fixed: BufferGeometry[]; flaps: BufferGeometry[]; painted: BufferGeometry[] } {
  const main = wing({
    span: FRONT_SPAN,
    lead: sym([2.60, 2.67, 2.725, 2.745]),
    height: sym([0.118, 0.096, 0.086, 0.085]),
    chord: sym([0.21, 0.25, 0.27, 0.27]),
    pitch: sym([0.12, 0.07, 0.045, 0.04]),
    thickness: 0.09,
    spanSegments: r.wingSpan,
    samples: r.wingSamples,
  });
  const flapOne = wing({
    span: FRONT_SPAN,
    lead: sym([2.40, 2.46, 2.52, 2.54]),
    height: sym([0.225, 0.172, 0.146, 0.142]),
    chord: sym([0.15, 0.17, 0.17, 0.17]),
    pitch: sym([0.58, 0.44, 0.36, 0.34]),
    thickness: 0.085,
    spanSegments: r.wingSpan,
    samples: r.wingSamples,
  });
  const flapTwo = wing({
    span: FRONT_SPAN,
    lead: sym([2.27, 2.33, 2.39, 2.41]),
    height: sym([0.31, 0.238, 0.203, 0.198]),
    chord: sym([0.12, 0.13, 0.13, 0.13]),
    pitch: sym([0.88, 0.68, 0.56, 0.53]),
    thickness: 0.08,
    spanSegments: r.wingSpan,
    samples: r.wingSamples,
  });
  const endplate = sidePlate([
    [2.79, 0.05], [2.12, 0.05], [2.03, 0.12], [2.09, 0.345], [2.38, 0.37], [2.62, 0.25], [2.79, 0.12],
  ], 0.886, 0.012);
  return { fixed: [main], flaps: [flapOne], painted: [flapTwo, ...bothSides(endplate)] };
}

const REAR_SPAN = [-0.515, -0.3, 0, 0.3, 0.515];

function rearWing(r: Resolution): { main: BufferGeometry; flap: BufferGeometry; pivot: Vector3; carbon: BufferGeometry[]; painted: BufferGeometry[]; lights: BufferGeometry[] } {
  const main = wing({
    span: REAR_SPAN,
    lead: [-2.11, -2.095, -2.085, -2.095, -2.11],
    height: [0.862, 0.848, 0.842, 0.848, 0.862],
    chord: [0.30, 0.30, 0.30, 0.30, 0.30],
    pitch: [0.17, 0.15, 0.14, 0.15, 0.17],
    thickness: 0.1,
    spanSegments: Math.round(r.wingSpan * 0.6),
    samples: r.wingSamples,
  });
  const pivot = new Vector3(0, 0.928, -2.33);
  // Built relative to its pivot so it can swing flat without leaving it.
  const flap = wing({
    span: REAR_SPAN,
    lead: [0, 0, 0, 0, 0],
    height: [0, 0, 0, 0, 0],
    chord: [0.185, 0.185, 0.185, 0.185, 0.185],
    pitch: [0.62, 0.6, 0.58, 0.6, 0.62],
    thickness: 0.09,
    spanSegments: Math.round(r.wingSpan * 0.6),
    samples: r.wingSamples,
  });
  const beamOne = wing({
    span: [-0.42, 0, 0.42],
    lead: [-2.10, -2.10, -2.10],
    height: [0.405, 0.40, 0.405],
    chord: [0.17, 0.17, 0.17],
    pitch: [0.22, 0.2, 0.22],
    thickness: 0.1,
    spanSegments: Math.round(r.wingSpan * 0.4),
    samples: r.wingSamples,
  });
  const beamTwo = wing({
    span: [-0.42, 0, 0.42],
    lead: [-2.26, -2.26, -2.26],
    height: [0.448, 0.443, 0.448],
    chord: [0.13, 0.13, 0.13],
    pitch: [0.48, 0.46, 0.48],
    thickness: 0.09,
    spanSegments: Math.round(r.wingSpan * 0.4),
    samples: r.wingSamples,
  });
  const endplate = sidePlate([
    [-2.03, 0.44], [-1.99, 0.6], [-1.995, 0.85], [-2.035, 0.95], [-2.11, 0.995], [-2.42, 0.995], [-2.51, 0.965],
    [-2.565, 0.89], [-2.57, 0.72], [-2.49, 0.6], [-2.37, 0.44],
  ], 0.522, 0.012);
  const pylon = sidePlate([
    [-1.93, 0.32], [-2.07, 0.33], [-2.21, 0.86], [-2.09, 0.865], [-2.0, 0.56],
  ], 0, 0.022, 0.004);
  const rain = finish(new BoxGeometry(0.11, 0.05, 0.02));
  place(rain, new Vector3(0, 0.30, -2.433));
  const strip = finish(new BoxGeometry(0.012, 0.21, 0.01));
  place(strip, new Vector3(0.522, 0.80, -2.588));
  return {
    main,
    flap,
    pivot,
    carbon: [beamOne, beamTwo, pylon],
    painted: bothSides(endplate),
    lights: [rain, ...bothSides(strip)],
  };
}

function floor(): BufferGeometry[] {
  const half: [number, number][] = [
    [0.22, 1.42], [0.46, 1.26], [0.63, 1.05], [0.80, 0.76], [0.905, 0.46], [0.925, 0.0], [0.92, -0.70],
    [0.86, -1.00], [0.70, -1.22], [0.53, -1.31], [0.53, -1.33],
  ];
  const outline: [number, number][] = [...half, ...half.slice().reverse().map(([x, z]) => [-x, z] as [number, number])];
  const plate = planPlate(outline, 0.034, 0.02, 0.005);
  const edge = sidePlate([[0.46, 0.056], [-0.68, 0.056], [-0.68, 0.11], [0.30, 0.125]], 0.918, 0.008, 0.002);
  // Diffuser: a ramp between the rear wheels, split by fences.
  const rampLength = Math.hypot(0.7, 0.255);
  const ramp = finish(new BoxGeometry(1.06, 0.012, rampLength));
  ramp.rotateX(-Math.atan2(0.255, 0.7));
  place(ramp, new Vector3(0, 0.045 + 0.255 / 2, -1.33 - 0.35));
  const fence = (x: number) => sidePlate([[-1.32, 0.045], [-2.03, 0.045], [-2.03, 0.315], [-1.32, 0.065]], x, 0.008, 0.002);
  // A plank of the floor under the chassis.
  const plank = finish(new BoxGeometry(0.3, 0.012, 2.4));
  place(plank, new Vector3(0, 0.028, -0.05));
  return [plate, ...bothSides(edge), ramp, ...bothSides(fence(0.53)), ...bothSides(fence(0.27)), plank];
}

function crash(r: Resolution): BufferGeometry {
  return loft(CRASH, { radial: r.smallRadial, rings: Math.max(6, r.smallRings / 3), capStart: 'flat', capEnd: 'flat' });
}

/** Wishbones, push/pull rods and track rods, in carbon. */
function suspension(): BufferGeometry[] {
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const fz = CAR_DIMENSIONS.frontAxleZ;
  const rz = CAR_DIMENSIONS.rearAxleZ;
  const left = [
    // Front upper and lower wishbones, pushrod, track rod.
    strut(v(0.17, 0.53, fz + 0.2), v(0.64, 0.50, fz)),
    strut(v(0.19, 0.51, fz - 0.26), v(0.64, 0.50, fz)),
    strut(v(0.15, 0.25, fz + 0.26), v(0.69, 0.205, fz)),
    strut(v(0.19, 0.23, fz - 0.30), v(0.69, 0.205, fz)),
    strut(v(0.67, 0.22, fz + 0.02), v(0.2, 0.56, fz - 0.02), 0.026, 0.012),
    strut(v(0.18, 0.32, fz + 0.1), v(0.68, 0.29, fz + 0.11), 0.026, 0.012),
    // Rear upper and lower wishbones, pullrod, toe link.
    strut(v(0.16, 0.47, rz + 0.26), v(0.6, 0.53, rz)),
    strut(v(0.15, 0.45, rz - 0.22), v(0.6, 0.53, rz)),
    strut(v(0.15, 0.18, rz + 0.32), v(0.645, 0.2, rz)),
    strut(v(0.14, 0.18, rz - 0.22), v(0.645, 0.2, rz)),
    strut(v(0.61, 0.5, rz + 0.04), v(0.17, 0.22, rz + 0.08), 0.026, 0.012),
    strut(v(0.16, 0.32, rz - 0.28), v(0.64, 0.33, rz - 0.15), 0.026, 0.012),
  ];
  // Uprights, mostly hidden inside the rims.
  const uprightFront = finish(new BoxGeometry(0.05, 0.34, 0.12));
  place(uprightFront, v(0.66, 0.36, fz));
  const uprightRear = finish(new BoxGeometry(0.05, 0.36, 0.14));
  place(uprightRear, v(0.62, 0.36, rz));
  return [...left, uprightFront, uprightRear].flatMap((part) => [part, mirrorX(part)]);
}

function helmet(r: Resolution): { shell: BufferGeometry; visor: BufferGeometry } {
  const segments = r === RESOLUTION.high ? 40 : 14;
  const shell = finish(new SphereGeometry(0.126, segments, Math.round(segments * 0.75)));
  shell.scale(0.92, 1, 1.12);
  place(shell, new Vector3(0, 0.845, -0.1));
  const visor = finish(new SphereGeometry(0.1285, segments, Math.round(segments * 0.5), Math.PI / 2 - 0.95, 1.9, 1.08, 0.42));
  visor.scale(0.92, 1, 1.12);
  place(visor, new Vector3(0, 0.845, -0.1));
  return { shell, visor };
}

/**
 * One wheel at the origin, axle along X, the rim face towards +X (outboard
 * on the left of the car; the right-hand wheels are turned to face out).
 */
function wheel(halfWidth: number, r: Resolution): WheelGeometry {
  const R = CAR_DIMENSIONS.tyreRadius;
  const W = halfWidth;
  const profile = [
    [0.231, -0.93], [0.262, -0.985], [0.300, -1.0], [0.330, -0.985], [0.349, -0.945], [0.357, -0.87],
    [0.3605, -0.7], [0.3618, -0.35], [R, 0], [0.3618, 0.35], [0.3605, 0.7], [0.357, 0.87], [0.349, 0.945],
    [0.330, 0.985], [0.300, 1.0], [0.262, 0.985], [0.231, 0.93],
  ].map(([radius, axial]) => new Vector2(radius, axial * W));
  const tyre = finish(new LatheGeometry(profile, r.wheelSegments));
  // Lathe revolves about Y; turn it so the axle is X.
  tyre.rotateZ(-Math.PI / 2);

  const rimProfile = [
    [0.236, -0.93], [0.236, -0.86], [0.222, -0.84], [0.216, -0.6], [0.216, 0.55], [0.222, 0.78], [0.236, 0.82], [0.236, 0.9],
  ].map(([radius, axial]) => new Vector2(radius, axial * W));
  const barrel = finish(new LatheGeometry(rimProfile, Math.max(16, r.wheelSegments / 2)));
  barrel.rotateZ(-Math.PI / 2);
  const parts: BufferGeometry[] = [barrel];
  const spokes = r === RESOLUTION.high ? 10 : 5;
  for (let index = 0; index < spokes; index += 1) {
    const angle = (index / spokes) * Math.PI * 2;
    const spoke = finish(new BoxGeometry(0.022, 0.15, 0.032));
    // Dished: the spoke leans in towards the hub.
    spoke.rotateZ(0.12);
    spoke.translate(W * 0.66, 0.145, 0);
    spoke.rotateX(angle);
    parts.push(spoke);
  }
  const hub = finish(new CylinderGeometry(0.075, 0.08, 0.07, Math.max(12, r.wheelSegments / 3)));
  hub.rotateZ(-Math.PI / 2);
  hub.translate(W * 0.6, 0, 0);
  parts.push(hub);
  const rim = merge(parts);

  const drum = finish(new CylinderGeometry(0.2, 0.2, W * 1.3, Math.max(12, r.wheelSegments / 3), 1, false));
  drum.rotateZ(-Math.PI / 2);
  drum.translate(-W * 0.1, 0, 0);
  const brake = merge([drum]);

  const nutGeometry = finish(new CylinderGeometry(0.036, 0.036, 0.05, 6));
  nutGeometry.rotateZ(-Math.PI / 2);
  nutGeometry.translate(W * 0.68, 0, 0);
  const nut = merge([nutGeometry]);

  return { tyre: merge([tyre]), rim, brake, nut, halfWidth: W };
}

function build(detail: CarDetail): CarGeometry {
  const r = RESOLUTION[detail];
  const front = frontWing(r);
  const rear = rearWing(r);
  const mirror = mirrors(r);
  const head = helmet(r);

  const paint = merge([
    body(r),
    ...sidepods(r),
    airbox(r),
    sharkFin(),
    cockpitRim(r),
    ...halo(r),
    ...mirror.housings,
    ...front.painted,
    rear.main,
    ...rear.painted,
    cameraPod(),
  ]);
  const carbon = merge([
    ...front.fixed,
    ...rear.carbon,
    ...floor(),
    crash(r),
    ...suspension(),
    ...mirror.stalks,
  ]);
  const frontFlapPivot = new Vector3(0, 0.145, 2.54);
  const frontFlaps = merge(front.flaps);
  frontFlaps.translate(-frontFlapPivot.x, -frontFlapPivot.y, -frontFlapPivot.z);

  const { frontAxleZ: fz, rearAxleZ: rz, tyreRadius: tr, frontTrack, rearTrack } = CAR_DIMENSIONS;
  return {
    paint,
    carbon,
    rearFlap: merge([rear.flap]),
    rearFlapPivot: rear.pivot,
    frontFlaps,
    frontFlapPivot,
    helmet: merge([head.shell]),
    visor: merge([head.visor]),
    chrome: merge(mirror.glass),
    lights: merge(rear.lights),
    front: wheel(CAR_DIMENSIONS.frontTyreHalfWidth, r),
    rear: wheel(CAR_DIMENSIONS.rearTyreHalfWidth, r),
    wheelCentres: [
      new Vector3(frontTrack, tr, fz), new Vector3(-frontTrack, tr, fz),
      new Vector3(rearTrack, tr, rz), new Vector3(-rearTrack, tr, rz),
    ],
  };
}

const cache = new Map<CarDetail, CarGeometry>();

/** Built once per detail level and shared: geometry never differs between teams. */
export function carGeometry(detail: CarDetail): CarGeometry {
  let geometry = cache.get(detail);
  if (!geometry) {
    geometry = build(detail);
    cache.set(detail, geometry);
  }
  return geometry;
}

/** The rear flap's open angle in straight mode, radians (rotation about X, trailing edge down). */
export const STRAIGHT_MODE_REAR_FLAP = -0.5;
export const STRAIGHT_MODE_FRONT_FLAP = -0.22;
