import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';

const io = await new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.decoder': MeshoptDecoder,
  });

const doc = await io.read(process.argv[2]);
const root = doc.getRoot();

console.log('=== NODES ===');
const walk = (node, depth) => {
  const mesh = node.getMesh();
  console.log(
    `${'  '.repeat(depth)}${node.getName() || '(unnamed)'}` +
      (mesh ? `  [mesh: ${mesh.getName()} prims=${mesh.listPrimitives().length}]` : '') +
      `  t=${node.getTranslation().map((n) => n.toFixed(1))}` +
      ` s=${node.getScale().map((n) => n.toFixed(3))}`,
  );
  node.listChildren().forEach((c) => walk(c, depth + 1));
};
root.listScenes().forEach((s) => s.listChildren().forEach((n) => walk(n, 0)));

console.log(`\ncameras=${root.listCameras().length}`);

console.log('\n=== PRIMITIVES (material, tris, bbox) ===');
const rows = [];
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices();
    const tris = idx ? idx.getCount() / 3 : pos.getCount() / 3;
    const min = pos.getMinNormalized([]);
    const max = pos.getMaxNormalized([]);
    rows.push({
      material: prim.getMaterial()?.getName() ?? '(none)',
      tris: Math.round(tris),
      verts: pos.getCount(),
      min: min.map((n) => Math.round(n)),
      max: max.map((n) => Math.round(n)),
    });
  }
}
rows.sort((a, b) => b.tris - a.tris);
for (const r of rows) {
  console.log(
    `${String(r.tris).padStart(8)} tris  ${String(r.verts).padStart(8)} v  ` +
      `min[${r.min.join(',')}] max[${r.max.join(',')}]  ${r.material}`,
  );
}
console.log(`\ntotal prims=${rows.length} total tris=${rows.reduce((s, r) => s + r.tris, 0)}`);
