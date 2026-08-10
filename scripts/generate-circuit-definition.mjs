import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');

const CIRCUITS = Object.freeze({
  suzuka: {
    displayName: 'Suzuka Circuit',
    officialLengthMeters: 5_807,
    laps: 53,
    centerMaterial: /^groove$/u,
    pitMaterial: /^PITROAD$/u,
    startMaterial: /^PITROAD$/u,
    step: 5,
    disc: 20,
    heightWeight: 4,
    headingDamping: 0.52,
    mainStraightDirection: [0, -1],
    sectors: [0.34, 0.67, 1],
    passingZones: [[0.72, 0.84], [0.93, 0.04]],
    cameras: [
      { id: 'turns-1-2', name: 'Turns 1-2', distance: 0.06, offset: 42, height: 18 },
      { id: 'esses', name: 'S Curves', distance: 0.15, offset: 48, height: 24 },
      { id: 'dunlop-rise', name: 'Dunlop Rise', distance: 0.24, offset: 44, height: 28 },
      { id: 'degner', name: 'Degner Curves', distance: 0.34, offset: 38, height: 18 },
      { id: 'hairpin', name: 'Hairpin', distance: 0.46, offset: 40, height: 20 },
      { id: 'spoon', name: 'Spoon Curve', distance: 0.62, offset: 48, height: 22 },
      { id: 'back-straight', name: 'Back Straight', distance: 0.76, offset: 52, height: 24 },
      { id: 'one-thirty-r', name: '130R', distance: 0.84, offset: 46, height: 21 },
      { id: 'casio-triangle', name: 'Casio Triangle', distance: 0.92, offset: 38, height: 18 },
      { id: 'pit-straight', name: 'Pit Straight', distance: 0.985, offset: 36, height: 16 },
    ],
  },
  melbourne: {
    displayName: 'Albert Park Circuit',
    officialLengthMeters: 5_278,
    laps: 58,
    centerMaterial: /^asp-grp\.004$/u,
    pitMaterial: /^pitlane\.004$/u,
    startMaterial: /^mel_startline_box_a_01\.004$/u,
    step: 5,
    disc: 20,
    heightWeight: 3,
    headingDamping: 0.54,
    mainStraightDirection: [-0.7, -0.7],
    sectors: [0.31, 0.66, 1],
    passingZones: [[0.96, 0.07], [0.52, 0.66]],
    cameras: [
      { id: 'turn-1', name: 'Turn 1 Braking', distance: 0.045, offset: 68, height: 36 },
      { id: 'turn-3', name: 'Turn 3', distance: 0.14, offset: 64, height: 35 },
      { id: 'turns-5-6', name: 'Turns 5-6 Sweep', distance: 0.28, offset: 72, height: 42 },
      { id: 'turns-9-10', name: 'Turns 9-10', distance: 0.46, offset: 72, height: 42 },
      { id: 'lakeside', name: 'Lakeside Drone', distance: 0.59, offset: 80, height: 130, side: -1 },
      { id: 'turn-11', name: 'Turn 11 Entry', distance: 0.68, offset: 68, height: 38 },
      { id: 'turn-13', name: 'Turn 13', distance: 0.78, offset: 66, height: 36 },
      { id: 'turn-15', name: 'Turn 15', distance: 0.89, offset: 66, height: 36 },
      { id: 'pit-straight', name: 'Pit Straight', distance: 0.985, offset: 84, height: 46 },
    ],
  },
  barcelona: {
    displayName: 'Circuit de Barcelona-Catalunya',
    sourceFile: 'untitled.glb',
    officialLengthMeters: 4_657,
    laps: 66,
    centerMaterial: /^(?:ROAD_TRACKMAIN|ROAD_TRACKMAIN_L|STRP_PITSKIDS02)$/u,
    pitMaterial: /^rdpitla$/u,
    startMaterial: /^WHITELINE5$/u,
    step: 4.5,
    disc: 18,
    closureTolerance: 27,
    smoothingPasses: 10,
    heightWeight: 3,
    headingDamping: 0.54,
    mainStraightDirection: [0.5, -0.85],
    sectors: [0.32, 0.68, 1],
    passingZones: [[0.97, 0.08], [0.49, 0.58]],
    cameras: [
      { id: 'elf', name: 'Elf Chicane', distance: 0.06, offset: 42, height: 24 },
      { id: 'renault', name: 'Renault Curve', distance: 0.15, offset: 46, height: 26 },
      { id: 'repsol', name: 'Repsol Hairpin', distance: 0.25, offset: 42, height: 24 },
      { id: 'seat', name: 'Seat Hairpin', distance: 0.36, offset: 40, height: 22 },
      { id: 'campsa', name: 'Campsa Curve', distance: 0.5, offset: 50, height: 28 },
      { id: 'la-caixa', name: 'La Caixa', distance: 0.64, offset: 46, height: 25 },
      { id: 'banc-sabadell', name: 'Banc Sabadell', distance: 0.75, offset: 42, height: 24 },
      { id: 'new-holland', name: 'New Holland', distance: 0.9, offset: 48, height: 26 },
      { id: 'pit-straight', name: 'Pit Straight', distance: 0.985, offset: 52, height: 30 },
    ],
  },
  spa: {
    displayName: 'Circuit de Spa-Francorchamps',
    officialLengthMeters: 7_004,
    laps: 44,
    centerMaterial: /^groove(?:1|2|3|_custom)\.001$/u,
    pitMaterial: /^asph-pitlane-old\.001$/u,
    startMaterial: /^spa-start-lights-emissive\.001$/u,
    traceStartMaterial: /^doted_line\.001$/u,
    step: 5.5,
    disc: 22,
    seamBridgeRadius: 70,
    seamBridgeReview: {
      rejectedRadiusMeters: 44,
      rejectedResult: 'Primary march stopped after 5675.8 m with a 757.7 m closure gap; no forward source vertices were found at 22, 33, or 44 m, while three existed inside 66 m.',
      acceptanceBasis: 'The 70 m search bound reaches only forward vertices from the selected GLB groove materials; the accepted march selects a maximum 53.61 m cursor-to-source continuation (52.88 m between its nearest exact source vertices), without manual route points.',
      diagnosticObservations: [
        'Overhead: the complete characteristic Spa loop and all racing lines remain on the modeled road through every sector.',
        'Track level 1: the pit-straight racing lines, 22 grid slots, and old pit-lane source align with the visible asphalt.',
        'Track level 2: the raised Raidillon view keeps all three racing lines on the uphill curbed roadway and confirms preserved elevation.',
      ],
    },
    closureTolerance: 30,
    heightWeight: 4,
    headingDamping: 0.53,
    mainStraightDirection: [0.7, 0.7],
    sectors: [0.32, 0.66, 1],
    passingZones: [[0.16, 0.28], [0.91, 0.03]],
    cameras: [
      { id: 'la-source', name: 'La Source', distance: 0.035, offset: 46, height: 24 },
      { id: 'eau-rouge', name: 'Eau Rouge', distance: 0.11, offset: 52, height: 30 },
      { id: 'raidillon', name: 'Raidillon Crest', distance: 0.15, offset: 90, height: 100, side: -1 },
      { id: 'kemmel', name: 'Kemmel Straight', distance: 0.23, offset: 60, height: 34 },
      { id: 'les-combes', name: 'Les Combes', distance: 0.32, offset: 48, height: 26 },
      { id: 'bruxelles', name: 'Bruxelles', distance: 0.43, offset: 46, height: 24 },
      { id: 'pouhon', name: 'Pouhon', distance: 0.56, offset: 56, height: 30 },
      { id: 'fagnes', name: 'Fagnes', distance: 0.65, offset: 48, height: 26 },
      { id: 'stavelot', name: 'Stavelot', distance: 0.74, offset: 50, height: 28 },
      { id: 'blanchimont', name: 'Blanchimont', distance: 0.86, offset: 58, height: 32 },
      { id: 'bus-stop', name: 'Bus Stop Chicane', distance: 0.95, offset: 44, height: 24 },
      { id: 'pit-straight', name: 'Pit Straight', distance: 0.99, offset: 52, height: 28 },
    ],
  },
  silverstone: {
    displayName: 'Silverstone Circuit',
    officialLengthMeters: 5_891,
    laps: 52,
    centerMaterial: /^(?:groove(?:2|3)?|asphalt)\.001$/u,
    pitMaterial: /^asph_pitlane\.001$/u,
    startMaterial: /^walls2\.001$/u,
    pitSelectionRadius: 450,
    step: 5,
    disc: 20,
    heightWeight: 3,
    headingDamping: 0.53,
    mainStraightDirection: [1, 0],
    sectors: [0.33, 0.67, 1],
    passingZones: [[0.96, 0.08], [0.55, 0.68]],
    cameras: [
      { id: 'abbey', name: 'Abbey', distance: 0.045, offset: 48, height: 27 },
      { id: 'village', name: 'Village', distance: 0.14, offset: 45, height: 25 },
      { id: 'wellington', name: 'Wellington Straight', distance: 0.25, offset: 58, height: 31 },
      { id: 'brooklands', name: 'Brooklands', distance: 0.33, offset: 46, height: 25 },
      { id: 'copse', name: 'Copse', distance: 0.48, offset: 52, height: 29 },
      { id: 'maggotts', name: 'Maggotts', distance: 0.58, offset: 90, height: 70, side: -1 },
      { id: 'becketts', name: 'Becketts', distance: 0.64, offset: 54, height: 31 },
      { id: 'hangar-straight', name: 'Hangar Straight', distance: 0.73, offset: 64, height: 36 },
      { id: 'stowe', name: 'Stowe', distance: 0.83, offset: 50, height: 28 },
      { id: 'club', name: 'Club', distance: 0.91, offset: 47, height: 26 },
      { id: 'hamilton-straight', name: 'Hamilton Straight', distance: 0.985, offset: 66, height: 38 },
    ],
  },
});

const transformPoint = (point, matrix) => [
  matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
  matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
  matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
];

const pointDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const planarDistance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

function centroid(points) {
  const sum = points.reduce((total, point) => [
    total[0] + point[0],
    total[1] + point[1],
    total[2] + point[2],
  ], [0, 0, 0]);
  return sum.map((value) => value / points.length);
}

function materialVertices(root, pattern) {
  const matches = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const matrix = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial()?.getName() ?? '';
      if (!pattern.test(material)) continue;
      pattern.lastIndex = 0;
      const position = primitive.getAttribute('POSITION');
      const points = [];
      for (let index = 0; index < position.getCount(); index += 1) {
        points.push(transformPoint(position.getElement(index, []), matrix));
      }
      matches.push({ material, matrix: [...matrix], points });
    }
  }
  return matches;
}

function nearestIndex(points, target) {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const candidate = pointDistance(points[index], target);
    if (candidate < distance) {
      distance = candidate;
      best = index;
    }
  }
  return best;
}

function loopLength(points) {
  return points.reduce((total, point, index) => total + pointDistance(point, points[(index + 1) % points.length]), 0);
}

function resampleClosed(points, count) {
  const segmentLengths = points.map((point, index) => pointDistance(point, points[(index + 1) % points.length]));
  const total = segmentLengths.reduce((sum, value) => sum + value, 0);
  const output = [];
  let segment = 0;
  let accumulated = 0;
  for (let sample = 0; sample < count; sample += 1) {
    const target = (sample / count) * total;
    while (segment < segmentLengths.length - 1 && accumulated + segmentLengths[segment] < target) {
      accumulated += segmentLengths[segment];
      segment += 1;
    }
    const start = points[segment];
    const end = points[(segment + 1) % points.length];
    const length = segmentLengths[segment] || 1;
    const amount = (target - accumulated) / length;
    output.push([
      start[0] + (end[0] - start[0]) * amount,
      start[1] + (end[1] - start[1]) * amount,
      start[2] + (end[2] - start[2]) * amount,
    ]);
  }
  return output;
}

function smoothClosed(points, passes = 2) {
  let output = points;
  for (let pass = 0; pass < passes; pass += 1) {
    output = output.map((point, index) => {
      const previous = output[(index - 1 + output.length) % output.length];
      const next = output[(index + 1) % output.length];
      return [
        point[0] * 0.5 + previous[0] * 0.25 + next[0] * 0.25,
        point[1] * 0.5 + previous[1] * 0.25 + next[1] * 0.25,
        point[2] * 0.5 + previous[2] * 0.25 + next[2] * 0.25,
      ];
    });
  }
  return output;
}

function buildSpatialIndex(points, cellSize) {
  const buckets = new Map();
  const key = (x, z) => `${x},${z}`;
  for (const point of points) {
    const cell = key(Math.floor(point[0] / cellSize), Math.floor(point[2] / cellSize));
    if (!buckets.has(cell)) buckets.set(cell, []);
    buckets.get(cell).push(point);
  }
  return (center, radius, heightWeight) => {
    const found = [];
    const cells = Math.ceil(radius / cellSize);
    const centerX = Math.floor(center[0] / cellSize);
    const centerZ = Math.floor(center[2] / cellSize);
    for (let x = -cells; x <= cells; x += 1) {
      for (let z = -cells; z <= cells; z += 1) {
        for (const point of buckets.get(key(centerX + x, centerZ + z)) ?? []) {
          if (Math.hypot(
            point[0] - center[0],
            (point[1] - center[1]) * heightWeight,
            point[2] - center[2],
          ) <= radius) found.push(point);
        }
      }
    }
    return found;
  };
}

function principalDirection(points, near, seed, config) {
  const local = near(seed, config.disc, config.heightWeight);
  const middle = centroid(local);
  let xx = 0;
  let xz = 0;
  let zz = 0;
  for (const point of local) {
    const x = point[0] - middle[0];
    const z = point[2] - middle[2];
    xx += x * x;
    xz += x * z;
    zz += z * z;
  }
  const theta = 0.5 * Math.atan2(2 * xz, xx - zz);
  return [Math.cos(theta), Math.sin(theta)];
}

function marchLoop(points, seed, initialHeading, config) {
  const near = buildSpatialIndex(points, config.disc);
  let cursor = [...seed];
  let heading = [...initialHeading];
  const path = [[...cursor]];
  let travelled = 0;
  let closureGap = Number.POSITIVE_INFINITY;
  let closestClosure = { gap: Number.POSITIVE_INFINITY, travelled: 0, pathIndex: 0 };
  let termination = 'maximum-steps';
  let seamBridgeSteps = 0;
  let maximumSeamBridgeDistance = 0;
  let maximumSeamBridge = null;
  const maximumSteps = Math.ceil((config.officialLengthMeters * 1.35) / config.step);

  for (let iteration = 0; iteration < maximumSteps; iteration += 1) {
    let local = near(cursor, config.disc, config.heightWeight).filter((point) => (
      (point[0] - cursor[0]) * heading[0] + (point[2] - cursor[2]) * heading[1] > config.step * 0.15
    ));
    if (local.length === 0 && config.seamBridgeRadius) {
      const candidates = near(cursor, config.seamBridgeRadius, config.heightWeight)
        .filter((point) => (
          (point[0] - cursor[0]) * heading[0] + (point[2] - cursor[2]) * heading[1] > config.step * 0.15
        ))
        .map((point) => ({ point, distance: pointDistance(cursor, point) }))
        .sort((a, b) => a.distance - b.distance);
      if (candidates.length > 0) {
        const nearestDistance = candidates[0].distance;
        local = candidates
          .filter((candidate) => candidate.distance <= nearestDistance + config.step * 1.5)
          .map((candidate) => candidate.point);
        seamBridgeSteps += 1;
        if (nearestDistance > maximumSeamBridgeDistance) {
          const fromSourceVertex = points[nearestIndex(points, cursor)];
          maximumSeamBridgeDistance = nearestDistance;
          maximumSeamBridge = {
            fromCursor: [...cursor],
            fromSourceVertex: [...fromSourceVertex],
            toSourceVertex: [...candidates[0].point],
            cursorToSourceDistance: nearestDistance,
            sourceEndpointDistance: pointDistance(fromSourceVertex, candidates[0].point),
          };
        }
      }
    }
    if (local.length === 0) {
      const forwardCounts = [1, 1.5, 2, 3].map((multiple) => {
        const radius = config.disc * multiple;
        const count = near(cursor, radius, config.heightWeight).filter((point) => (
          (point[0] - cursor[0]) * heading[0] + (point[2] - cursor[2]) * heading[1] > config.step * 0.15
        )).length;
        return `${radius.toFixed(1)}m:${count}`;
      });
      termination = `no-forward-points(${forwardCounts.join(',')})`;
      break;
    }
    const middle = centroid(local);
    let nextX = middle[0] - cursor[0];
    let nextZ = middle[2] - cursor[2];
    const nextLength = Math.hypot(nextX, nextZ);
    if (nextLength < 1e-6) {
      termination = 'zero-centroid-direction';
      break;
    }
    nextX /= nextLength;
    nextZ /= nextLength;
    heading[0] = heading[0] * (1 - config.headingDamping) + nextX * config.headingDamping;
    heading[1] = heading[1] * (1 - config.headingDamping) + nextZ * config.headingDamping;
    const headingLength = Math.hypot(...heading) || 1;
    heading[0] /= headingLength;
    heading[1] /= headingLength;

    const next = [
      cursor[0] + heading[0] * config.step,
      middle[1],
      cursor[2] + heading[1] * config.step,
    ];
    travelled += pointDistance(cursor, next);
    cursor = next;
    path.push(cursor);
    closureGap = pointDistance(cursor, seed);
    if (travelled > config.officialLengthMeters * 0.72 && closureGap < closestClosure.gap) {
      closestClosure = { gap: closureGap, travelled, pathIndex: path.length - 1 };
    }
    if (travelled > config.officialLengthMeters * 0.72 && closureGap < (config.closureTolerance ?? config.step * 2.2)) {
      termination = 'closed';
      break;
    }
  }

  return {
    path,
    travelled,
    closureGap,
    closestClosure,
    termination,
    seamBridgeSteps,
    maximumSeamBridgeDistance,
    maximumSeamBridge,
  };
}

function fitCenterline(points, tracePoint, config, zeroPoint = tracePoint) {
  const near = buildSpatialIndex(points, config.disc);
  const seed = points[nearestIndex(points, tracePoint)];
  const principal = principalDirection(points, near, seed, config);
  const attempts = [principal, [-principal[0], -principal[1]]].map((heading) => (
    marchLoop(points, seed, heading, config)
  ));
  const score = (attempt) => (
    Math.abs(attempt.travelled - config.officialLengthMeters) / config.officialLengthMeters
    + Math.min(1, attempt.closureGap / (config.disc * 2))
  );
  const selected = attempts.sort((a, b) => score(a) - score(b))[0];
  if (selected.closureGap > (config.closureTolerance ?? config.step * 3)) {
    const evidence = attempts.map(({ path, travelled, closureGap, closestClosure, termination, seamBridgeSteps, maximumSeamBridgeDistance }) => (
      `${path.length} points/${travelled.toFixed(1)} m/${closureGap.toFixed(1)} m gap/closest ${closestClosure.gap.toFixed(1)} m at ${closestClosure.travelled.toFixed(1)} m/end ${path.at(-1).map((value) => value.toFixed(1)).join(',')}/${termination}/bridges ${seamBridgeSteps} max ${maximumSeamBridgeDistance.toFixed(1)} m`
    )).join('; ');
    const error = new Error(`Centerline did not close (seed ${seed.map((value) => value.toFixed(1)).join(',')}; gap ${selected.closureGap.toFixed(1)} m; attempts: ${evidence})`);
    Object.defineProperty(error, 'fitEvidence', { value: { attempts, seed }, enumerable: false });
    throw error;
  }
  let centerline = smoothClosed(resampleClosed(selected.path.slice(0, -1), 360), config.smoothingPasses ?? 2);

  const tangent = [centerline[1][0] - centerline[0][0], centerline[1][2] - centerline[0][2]];
  if (tangent[0] * config.mainStraightDirection[0] + tangent[1] * config.mainStraightDirection[1] < 0) {
    centerline = [centerline[0], ...centerline.slice(1).reverse()];
  }
  const zero = nearestIndex(centerline, zeroPoint);
  centerline = [...centerline.slice(zero), ...centerline.slice(0, zero)];
  return {
    centerline,
    attempts: attempts.map(({ path, travelled, closureGap, closestClosure, termination, seamBridgeSteps, maximumSeamBridgeDistance, maximumSeamBridge }) => ({
      points: path.length,
      travelled,
      closureGap,
      closestClosure,
      termination,
      seamBridgeSteps,
      maximumSeamBridgeDistance,
      maximumSeamBridge,
    })),
  };
}

async function writeFitFailurePreview(id, sourcePoints, evidence) {
  const allPoints = [...sourcePoints, ...evidence.attempts.flatMap((attempt) => attempt.path)];
  const minX = Math.min(...allPoints.map((point) => point[0]));
  const maxX = Math.max(...allPoints.map((point) => point[0]));
  const minZ = Math.min(...allPoints.map((point) => point[2]));
  const maxZ = Math.max(...allPoints.map((point) => point[2]));
  const width = 1600;
  const height = 1200;
  const padding = 50;
  const scale = Math.min((width - padding * 2) / (maxX - minX || 1), (height - padding * 2) / (maxZ - minZ || 1));
  const project = (point) => [padding + (point[0] - minX) * scale, height - padding - (point[2] - minZ) * scale];
  const sourceDots = sourcePoints
    .filter((_, index) => index % Math.max(1, Math.floor(sourcePoints.length / 40_000)) === 0)
    .map((point) => {
      const [x, y] = project(point);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1" fill="#718096" fill-opacity="0.55"/>`;
    }).join('');
  const paths = evidence.attempts.map((attempt, index) => {
    const points = attempt.path.map((point) => project(point).map((value) => value.toFixed(1)).join(',')).join(' ');
    return `<polyline points="${points}" fill="none" stroke="${index === 0 ? '#ff355e' : '#00d8ff'}" stroke-width="3"/>`;
  }).join('');
  const [seedX, seedY] = project(evidence.seed);
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#081018"/>${sourceDots}${paths}<circle cx="${seedX}" cy="${seedY}" r="7" fill="#ffe45e"/></svg>`;
  const output = resolve(PROJECT_ROOT, `work/assets-source/tracks/${id}/fit-failure.png`);
  await sharp(Buffer.from(svg)).png().toFile(output);
  return output;
}

function pcaAxis(points) {
  const middle = centroid(points);
  let xx = 0;
  let xz = 0;
  let zz = 0;
  for (const point of points) {
    const x = point[0] - middle[0];
    const z = point[2] - middle[2];
    xx += x * x;
    xz += x * z;
    zz += z * z;
  }
  const theta = 0.5 * Math.atan2(2 * xz, xx - zz);
  return [Math.cos(theta), Math.sin(theta)];
}

function derivePitLine(points, centerline) {
  const middle = centroid(points);
  const axis = pcaAxis(points);
  const projected = points.map((point) => ({
    point,
    distance: (point[0] - middle[0]) * axis[0] + (point[2] - middle[2]) * axis[1],
  })).sort((a, b) => a.distance - b.distance);
  const minimum = projected[0].distance;
  const maximum = projected.at(-1).distance;
  const bins = Array.from({ length: 28 }, () => []);
  for (const item of projected) {
    const index = Math.min(bins.length - 1, Math.floor(((item.distance - minimum) / (maximum - minimum || 1)) * bins.length));
    bins[index].push(item.point);
  }
  let line = bins.filter((bin) => bin.length > 0).map(centroid);
  const endpointFractions = () => [
    nearestIndex(centerline, line[0]) / centerline.length,
    nearestIndex(centerline, line.at(-1)) / centerline.length,
  ];
  let fractions = endpointFractions();
  const forwardSpan = (fractions[1] - fractions[0] + 1) % 1;
  if (forwardSpan > 0.5) {
    line = line.reverse();
    fractions = endpointFractions();
  }
  return {
    line: [centerline[nearestIndex(centerline, line[0])], ...line, centerline[nearestIndex(centerline, line.at(-1))]],
    entry: fractions[0],
    exit: fractions[1],
  };
}

function createCameraAnchors(centerline, config) {
  const bounds = {
    min: [
      Math.min(...centerline.map((point) => point[0])),
      Math.min(...centerline.map((point) => point[1])),
      Math.min(...centerline.map((point) => point[2])),
    ],
    max: [
      Math.max(...centerline.map((point) => point[0])),
      Math.max(...centerline.map((point) => point[1])),
      Math.max(...centerline.map((point) => point[2])),
    ],
  };
  const anchors = config.cameras.map((shot) => {
    const index = Math.floor(shot.distance * centerline.length) % centerline.length;
    const point = centerline[index];
    const previous = centerline[(index - 3 + centerline.length) % centerline.length];
    const next = centerline[(index + 3) % centerline.length];
    const tangentX = next[0] - previous[0];
    const tangentZ = next[2] - previous[2];
    const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
    const normal = [-tangentZ / tangentLength, tangentX / tangentLength];
    const behind = centerline[(index - 8 + centerline.length) % centerline.length];
    const ahead = centerline[(index + 8) % centerline.length];
    const curvature = (
      (ahead[0] - 2 * point[0] + behind[0]) * normal[0]
      + (ahead[2] - 2 * point[2] + behind[2]) * normal[1]
    );
    const outside = (curvature > 0 ? -1 : 1) * (shot.side ?? 1);
    return {
      id: shot.id,
      name: shot.name,
      distance: shot.distance,
      position: [
        point[0] + normal[0] * shot.offset * outside,
        point[1] + shot.height,
        point[2] + normal[1] * shot.offset * outside,
      ],
      targetOffset: [0, 1.2, 0],
    };
  });
  const center = [
    (bounds.min[0] + bounds.max[0]) / 2,
    bounds.max[1] + Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]) * 0.62,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  anchors.unshift({
    id: 'birds-eye',
    name: "Bird's-eye Overview",
    distance: 0.5,
    position: center,
    targetOffset: [0, 0, 0],
  });
  return { anchors, bounds };
}

const fixed = (value, digits = 3) => Number(value.toFixed(digits));
const pointLiteral = (point) => `{ x: ${fixed(point[0])}, y: ${fixed(point[1])}, z: ${fixed(point[2])} }`;

function createOutlinePoints(centerline, samples = 120) {
  const step = Math.max(1, Math.ceil(centerline.length / samples));
  return centerline
    .filter((_, index) => index % step === 0)
    .map((point) => ({ x: fixed(point[0]), z: fixed(point[2]) }));
}

function emitTrackModule(id, config, centerline, pit, cameras, fittedLength) {
  const symbol = id.replaceAll('-', '_').toUpperCase();
  const closed = [...centerline, centerline[0]];
  const centerRows = closed.map((point) => `  ${pointLiteral(point)},`).join('\n');
  const pitRows = pit.line.map((point) => `  ${pointLiteral(point)},`).join('\n');
  const slots = Array.from({ length: 22 }, (_, index) => {
    const row = Math.floor(index / 2);
    const back = 12 + row * 8;
    return { distance: (1 - back / fittedLength + 1) % 1, lateral: index % 2 === 0 ? -3.2 : 3.2 };
  });
  return `// GENERATED FILE — derive again with scripts/generate-circuit-definition.mjs.
// Centerline and pit geometry come from named materials in the supplied GLB.
// Fitted lap: ${fittedLength.toFixed(1)} m; official lap: ${config.officialLengthMeters} m.
import type { TrackDefinition, TrackPoint } from '../track-types';

export const ${symbol}_RACE_LAPS = ${config.laps};

const centerLine: TrackPoint[] = [
${centerRows}
];

const pitLine: TrackPoint[] = [
${pitRows}
];

const offsetClosedLine = (amount: number): TrackPoint[] => {
  const loop = centerLine.slice(0, -1);
  const offset = loop.map((point, index) => {
    const previous = loop[(index - 1 + loop.length) % loop.length];
    const next = loop[(index + 1) % loop.length];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    return { x: point.x - (dz / length) * amount, y: point.y, z: point.z + (dx / length) * amount };
  });
  return [...offset, { ...offset[0] }];
};

export const ${symbol}_TRACK: TrackDefinition = {
  id: '${id}',
  lengthMeters: ${Math.round(fittedLength)},
  centerLine,
  attackLine: offsetClosedLine(-2.4),
  defendLine: offsetClosedLine(2.4),
  pitLine,
  pitEntry: ${fixed(pit.entry, 4)},
  pitExit: ${fixed(pit.exit, 4)},
  sectors: [${config.sectors.join(', ')}],
  gridSlots: [
${slots.map((slot) => `    { distance: ${slot.distance.toFixed(4)}, lateral: ${slot.lateral} },`).join('\n')}
  ],
  zones: [
${config.passingZones.map(([start, end]) => `    { start: ${start}, end: ${end}, kind: 'passing' },`).join('\n')}
    { start: 0, end: 1, kind: 'yellow' },
    { start: ${fixed(pit.entry, 4)}, end: ${fixed(pit.exit, 4)}, kind: 'speed-limit' },
  ],
  cameraAnchors: [
${cameras.map((anchor) => `    {
      id: '${anchor.id}',
      name: '${anchor.name.replaceAll("'", "\\'")}',
      distance: ${anchor.distance},
      position: ${pointLiteral(anchor.position)},
      targetOffset: ${pointLiteral(anchor.targetOffset)},
    },`).join('\n')}
  ],
};
`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--circuit') throw new Error('Expected --circuit <id>');
  const id = args[1];
  const config = CIRCUITS[id];
  if (!config) throw new Error(`No derivation configuration for ${id}`);

  const source = resolve(
    PROJECT_ROOT,
    `work/assets-source/tracks/${id}/original/source`,
    config.sourceFile ?? (id === 'suzuka' ? 'suzukibananini.glb' : `${id}.glb`),
  );
  const runtimeManifestPath = resolve(PROJECT_ROOT, `public/assets/models/tracks/${id}.manifest.json`);
  if (!existsSync(source) || !existsSync(runtimeManifestPath)) throw new Error(`Run analyze/optimize/generate for ${id} first`);
  const runtimeManifest = JSON.parse(readFileSync(runtimeManifestPath, 'utf8'));

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.decoder': MeshoptDecoder,
  });
  const document = await io.read(source);
  const root = document.getRoot();
  const centerMatches = materialVertices(root, config.centerMaterial);
  const pitMatches = materialVertices(root, config.pitMaterial);
  const startMatches = materialVertices(root, config.startMaterial);
  const traceMatches = config.traceStartMaterial ? materialVertices(root, config.traceStartMaterial) : startMatches;
  if (centerMatches.length === 0 || pitMatches.length === 0 || startMatches.length === 0 || traceMatches.length === 0) {
    throw new Error(`Missing configured material for ${id}`);
  }
  const sourcePoints = centerMatches.flatMap((match) => match.points);
  const allPitPoints = pitMatches.flatMap((match) => match.points);
  const startPoint = centroid(startMatches.flatMap((match) => match.points));
  const tracePoint = centroid(traceMatches.flatMap((match) => match.points));
  const pitPoints = config.pitSelectionRadius
    ? allPitPoints.filter((point) => pointDistance(point, startPoint) <= config.pitSelectionRadius)
    : allPitPoints;
  if (pitPoints.length === 0) throw new Error(`Pit selection removed every configured material vertex for ${id}`);
  let fit;
  try {
    fit = fitCenterline(sourcePoints, tracePoint, config, startPoint);
  } catch (error) {
    if (error instanceof Error && error.fitEvidence) {
      const diagnostic = await writeFitFailurePreview(id, sourcePoints, error.fitEvidence);
      error.message += `; diagnostic ${diagnostic}`;
    }
    throw error;
  }
  const fittedLength = loopLength(fit.centerline);
  const errorPercent = ((fittedLength - config.officialLengthMeters) / config.officialLengthMeters) * 100;
  if (Math.abs(errorPercent) > 5) throw new Error(`Fitted length error is ${errorPercent.toFixed(2)}%`);
  const pit = derivePitLine(pitPoints, fit.centerline);
  const { anchors, bounds } = createCameraAnchors(fit.centerline, config);

  const output = resolve(PROJECT_ROOT, `src/track/generated/${id}-track.ts`);
  const generatedManifestPath = resolve(PROJECT_ROOT, `src/track/generated/${id}-manifest.json`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, emitTrackModule(id, config, fit.centerline, pit, anchors, fittedLength));
  const generatedManifest = {
    schemaVersion: 1,
    circuitId: id,
    displayName: config.displayName,
    outlinePoints: createOutlinePoints(fit.centerline),
    source: {
      archive: runtimeManifest.source.archive,
      stagedArchive: runtimeManifest.source.stagedArchive,
      model: runtimeManifest.source.model,
      archiveSha256: runtimeManifest.source.sha256,
      centerlineMaterials: [...new Set(centerMatches.map((match) => match.material))],
      pitMaterials: [...new Set(pitMatches.map((match) => match.material))],
      traceStartMaterials: [...new Set(traceMatches.map((match) => match.material))],
    },
    visibleTransform: {
      strategy: 'source-node-world-matrix-preserved',
      matrices: [...new Map(centerMatches.map((match) => [JSON.stringify(match.matrix), match.matrix])).values()],
    },
    fit: {
      method: 'height-aware forward centroid march over source road material',
      sourceVertices: sourcePoints.length,
      outputPoints: fit.centerline.length + 1,
      officialLengthMeters: config.officialLengthMeters,
      fittedLengthMeters: fixed(fittedLength, 2),
      errorPercent: fixed(errorPercent, 3),
      closureAttempts: fit.attempts.map((attempt) => ({
        points: attempt.points,
        travelledMeters: fixed(attempt.travelled, 2),
        closureGapMeters: fixed(attempt.closureGap, 2),
        termination: attempt.termination,
        seamBridgeSteps: attempt.seamBridgeSteps,
        maximumSeamBridgeDistanceMeters: fixed(attempt.maximumSeamBridgeDistance, 2),
        maximumSeamBridge: attempt.maximumSeamBridge ? {
          fromCursorWorld: attempt.maximumSeamBridge.fromCursor.map((value) => fixed(value, 3)),
          fromSourceVertexWorld: attempt.maximumSeamBridge.fromSourceVertex.map((value) => fixed(value, 3)),
          toSourceVertexWorld: attempt.maximumSeamBridge.toSourceVertex.map((value) => fixed(value, 3)),
          cursorToSourceDistanceMeters: fixed(attempt.maximumSeamBridge.cursorToSourceDistance, 2),
          sourceEndpointDistanceMeters: fixed(attempt.maximumSeamBridge.sourceEndpointDistance, 2),
        } : null,
      })),
      parameters: {
        stepMeters: config.step,
        samplingDiscMeters: config.disc,
        seamBridgeRadiusMeters: config.seamBridgeRadius ?? null,
        elevationWeight: config.heightWeight,
        headingDamping: config.headingDamping,
      },
      seamBridgeReview: config.seamBridgeReview ?? null,
      worldBounds: bounds,
    },
    pit: {
      sourceVertices: pitPoints.length,
      availableSourceVertices: allPitPoints.length,
      selectionRadiusFromStartMeters: config.pitSelectionRadius ?? null,
      outputPoints: pit.line.length,
      entry: fixed(pit.entry, 4),
      exit: fixed(pit.exit, 4),
    },
    runtime: runtimeManifest.output,
    diagnostics: [
      `work/assets-source/tracks/${id}/diagnostics/overhead.png`,
      `work/assets-source/tracks/${id}/diagnostics/track-level-1.png`,
      `work/assets-source/tracks/${id}/diagnostics/track-level-2.png`,
    ],
  };
  writeFileSync(generatedManifestPath, `${JSON.stringify(generatedManifest, null, 2)}\n`);

  const notesPath = resolve(PROJECT_ROOT, `work/assets-source/tracks/${id}/optimization-notes.md`);
  writeFileSync(notesPath, `# ${config.displayName} optimization notes

- Source archive: \`${runtimeManifest.source.archive}\`
- Preserved staged archive: \`${runtimeManifest.source.stagedArchive}\`
- Source archive SHA-256: \`${runtimeManifest.source.sha256}\`
- Optimized runtime: \`${runtimeManifest.output.runtimeFile}\`
- Runtime bytes: ${runtimeManifest.output.bytes.toLocaleString('en-US')} (30,000,000-byte default limit; no exception required)
- Runtime SHA-256: \`${runtimeManifest.output.sha256}\`
- Geometry: ${runtimeManifest.inspection.triangles.toLocaleString('en-US')} triangles, ${runtimeManifest.inspection.meshes} meshes, ${runtimeManifest.inspection.materials} materials
- Centerline source: material \`${centerMatches.map((match) => match.material).join(', ')}\`, transformed by its preserved GLB node world matrix
- Pit source: material \`${pitMatches.map((match) => match.material).join(', ')}\`
${config.pitSelectionRadius ? `- Pit selection: ${pitPoints.length} of ${allPitPoints.length} source vertices within ${config.pitSelectionRadius} m of the GLB start-marker material centroid
` : ''}- Fitted lap: ${fittedLength.toFixed(2)} m versus ${config.officialLengthMeters} m official (${errorPercent.toFixed(3)}%)
${config.seamBridgeReview ? `- Seam bridge review: ${config.seamBridgeReview.rejectedRadiusMeters} m was rejected (${config.seamBridgeReview.rejectedResult})
- Accepted seam evidence: ${config.seamBridgeReview.acceptanceBasis}
- Maximum bridge endpoints: ${fit.attempts.map((attempt) => attempt.maximumSeamBridge ? `cursor [${attempt.maximumSeamBridge.fromCursor.map((value) => fixed(value, 3)).join(', ')}], nearest source [${attempt.maximumSeamBridge.fromSourceVertex.map((value) => fixed(value, 3)).join(', ')}], target source [${attempt.maximumSeamBridge.toSourceVertex.map((value) => fixed(value, 3)).join(', ')}]` : 'none').join('; ')}
` : ''}- Licensing: **UNVERIFIED**, local prototype only; publication is not allowed.

The optimizer used mesh deduplication, instancing/palette consolidation, flatten/join/weld, conservative simplification (0.001 error), WebP textures at 1024 px, pruning, and meshopt compression. Reproducible extracted and optimized staging GLBs may be removed after publishing, but the original archives, public runtime, manifests, notes, and diagnostics must remain.
`);

  console.log(JSON.stringify({
    circuitId: id,
    sourceVertices: sourcePoints.length,
    fittedLengthMeters: fixed(fittedLength, 2),
    officialLengthMeters: config.officialLengthMeters,
    errorPercent: fixed(errorPercent, 3),
    pitPoints: pit.line.length,
    cameraAnchors: anchors.length,
    attempts: generatedManifest.fit.closureAttempts,
    output,
    manifest: generatedManifestPath,
    notes: notesPath,
  }));
}

await main();
