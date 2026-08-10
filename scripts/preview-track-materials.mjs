import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const [source, output, ...materialNames] = process.argv.slice(2);
if (!source || !output || materialNames.length === 0) {
  throw new Error('Usage: node scripts/preview-track-materials.mjs <source.glb> <output.png> <material> [...]');
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.decoder': MeshoptDecoder,
});
const document = await io.read(resolve(source));
const root = document.getRoot();

const transformPoint = (point, matrix) => [
  matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
  matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
  matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
];

const wanted = new Set(materialNames);
const samples = [];
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const matrix = node.getWorldMatrix();
  for (const primitive of mesh.listPrimitives()) {
    const material = primitive.getMaterial()?.getName() ?? '(none)';
    if (!wanted.has(material)) continue;
    const position = primitive.getAttribute('POSITION');
    for (let index = 0; index < position.getCount(); index += 1) {
      samples.push({ material, point: transformPoint(position.getElement(index, []), matrix) });
    }
  }
}
if (samples.length === 0) throw new Error(`None of the requested materials were found: ${materialNames.join(', ')}`);

const width = 1800;
const height = 1200;
const padding = 50;
const xs = samples.map(({ point }) => point[0]);
const zs = samples.map(({ point }) => point[2]);
const minX = Math.min(...xs);
const maxX = Math.max(...xs);
const minZ = Math.min(...zs);
const maxZ = Math.max(...zs);
const scale = Math.min((width - padding * 2) / (maxX - minX || 1), (height - padding * 2) / (maxZ - minZ || 1));
const project = ([x, , z]) => [padding + (x - minX) * scale, height - padding - (z - minZ) * scale];
const colors = ['#e8edf2', '#ff355e', '#00d8ff', '#ffcc33', '#b06cff', '#4be28b'];
const circles = samples
  .filter((_, index) => index % Math.max(1, Math.floor(samples.length / 45_000)) === 0)
  .map(({ material, point }) => {
    const [x, y] = project(point);
    const color = colors[materialNames.indexOf(material) % colors.length];
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.25" fill="${color}" fill-opacity="0.72"/>`;
  })
  .join('');
const legend = materialNames
  .map((name, index) => `<text x="50" y="${42 + index * 25}" fill="${colors[index % colors.length]}" font-family="monospace" font-size="18">${name}</text>`)
  .join('');
const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#0a1017"/>
  ${circles}
  <rect x="30" y="18" width="360" height="${materialNames.length * 25 + 20}" rx="8" fill="#05080c" fill-opacity="0.85"/>
  ${legend}
</svg>`;

mkdirSync(dirname(resolve(output)), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(resolve(output));
const materialStats = Object.fromEntries(materialNames.map((material) => {
  const points = samples.filter((sample) => sample.material === material).map((sample) => sample.point);
  if (points.length === 0) return [material, null];
  const sum = points.reduce((total, point) => total.map((value, index) => value + point[index]), [0, 0, 0]);
  return [material, {
    samples: points.length,
    centroid: sum.map((value) => Number((value / points.length).toFixed(3))),
    min: [0, 1, 2].map((axis) => Number(Math.min(...points.map((point) => point[axis])).toFixed(3))),
    max: [0, 1, 2].map((axis) => Number(Math.max(...points.map((point) => point[axis])).toFixed(3))),
  }];
}));
console.log(JSON.stringify({ source: resolve(source), output: resolve(output), samples: samples.length, bounds: { min: [minX, minZ], max: [maxX, maxZ] }, materialStats }));
