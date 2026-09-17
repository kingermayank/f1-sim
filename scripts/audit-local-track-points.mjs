import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const [source, output, minXText, maxXText, minZText, maxZText, ...materials] = process.argv.slice(2);
const bounds = [minXText, maxXText, minZText, maxZText].map(Number);
if (!source || !output || bounds.some((value) => !Number.isFinite(value)) || materials.length === 0) {
  throw new Error('Expected source output minX maxX minZ maxZ material [...]');
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.decoder': MeshoptDecoder,
});
const document = await io.read(source);
const wanted = new Set(materials);
const samples = [];
const transform = (point, matrix) => [
  matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
  matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
  matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
];
for (const node of document.getRoot().listNodes()) {
  if (!node.getMesh()) continue;
  for (const primitive of node.getMesh().listPrimitives()) {
    const material = primitive.getMaterial()?.getName() ?? '';
    if (!wanted.has(material)) continue;
    const positions = primitive.getAttribute('POSITION');
    for (let index = 0; index < positions.getCount(); index += 1) {
      const point = transform(positions.getElement(index, []), node.getWorldMatrix());
      if (point[0] >= bounds[0] && point[0] <= bounds[1] && point[2] >= bounds[2] && point[2] <= bounds[3]) {
        samples.push({ material, point });
      }
    }
  }
}

const width = 1200;
const height = 900;
const padding = 40;
const scale = Math.min((width - padding * 2) / (bounds[1] - bounds[0]), (height - padding * 2) / (bounds[3] - bounds[2]));
const colors = ['#ffffff', '#ff355e', '#00d8ff', '#ffcc33', '#b06cff'];
const circles = samples.map(({ material, point }) => {
  const x = padding + (point[0] - bounds[0]) * scale;
  const y = height - padding - (point[2] - bounds[2]) * scale;
  return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.4" fill="${colors[materials.indexOf(material) % colors.length]}" fill-opacity="0.72"/>`;
}).join('');
const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#081018"/>${circles}</svg>`;
await sharp(Buffer.from(svg)).png().toFile(output);
console.log(JSON.stringify({ samples: samples.length, bounds, materials, output }));
