import { resolve } from 'node:path';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';

const [source, ...materials] = process.argv.slice(2);
if (!source || materials.length === 0) {
  throw new Error('Usage: node scripts/inspect-material-components.mjs <source.glb> <material> [...]');
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.decoder': MeshoptDecoder,
});
const document = await io.read(resolve(source));
const wanted = new Set(materials);

const transformPoint = (point, matrix) => [
  matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
  matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
  matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
];

for (const node of document.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  for (const primitive of mesh.listPrimitives()) {
    const material = primitive.getMaterial()?.getName() ?? '(none)';
    if (!wanted.has(material)) continue;
    const positions = primitive.getAttribute('POSITION');
    const indices = primitive.getIndices();
    const parent = Array.from({ length: positions.getCount() }, (_, index) => index);
    const find = (value) => {
      let root = value;
      while (parent[root] !== root) root = parent[root];
      while (parent[value] !== value) {
        const next = parent[value];
        parent[value] = root;
        value = next;
      }
      return root;
    };
    const union = (a, b) => {
      const left = find(a);
      const right = find(b);
      if (left !== right) parent[right] = left;
    };
    const triangleCount = indices ? indices.getCount() / 3 : positions.getCount() / 3;
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const a = indices ? indices.getScalar(triangle * 3) : triangle * 3;
      const b = indices ? indices.getScalar(triangle * 3 + 1) : triangle * 3 + 1;
      const c = indices ? indices.getScalar(triangle * 3 + 2) : triangle * 3 + 2;
      union(a, b);
      union(a, c);
    }
    const matrix = node.getWorldMatrix();
    const components = new Map();
    for (let index = 0; index < positions.getCount(); index += 1) {
      const root = find(index);
      if (!components.has(root)) components.set(root, []);
      components.get(root).push(transformPoint(positions.getElement(index, []), matrix));
    }
    const summaries = [...components.values()].map((points) => ({
      vertices: points.length,
      min: [0, 1, 2].map((axis) => Number(Math.min(...points.map((point) => point[axis])).toFixed(2))),
      max: [0, 1, 2].map((axis) => Number(Math.max(...points.map((point) => point[axis])).toFixed(2))),
    })).sort((a, b) => b.vertices - a.vertices);
    console.log(JSON.stringify({ material, vertices: positions.getCount(), triangles: triangleCount, components: summaries.length, largest: summaries.slice(0, 20) }));
  }
}
