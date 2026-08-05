/**
 * Analyzes the Shanghai source GLB to recover the authoritative track geometry.
 *
 * Prints the root transform, resolves world-space bounds, and extracts the
 * `raceline` / `tarmac` surfaces so a centerline spline can be fitted to the
 * real model rather than hand-authored.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';

const io = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.decoder': MeshoptDecoder,
});

const doc = await io.read(process.argv[2]);
const root = doc.getRoot();

for (const scene of root.listScenes()) {
  for (const node of scene.listChildren()) {
    console.log('node        :', node.getName());
    console.log('translation :', node.getTranslation());
    console.log('rotation    :', node.getRotation());
    console.log('scale       :', node.getScale());
    console.log('matrix      :', node.getMatrix());
  }
}

const targets = (process.argv[3] ?? 'raceline,tarmac').split(',');
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial()?.getName() ?? '(none)';
    if (!targets.includes(name)) continue;
    const pos = prim.getAttribute('POSITION');
    const count = pos.getCount();
    const min = pos.getMinNormalized([]);
    const max = pos.getMaxNormalized([]);
    console.log(`\n--- ${name} ---`);
    console.log('verts:', count);
    console.log('min  :', min.map((n) => n.toFixed(2)).join(', '));
    console.log('max  :', max.map((n) => n.toFixed(2)).join(', '));
    const sample = [];
    for (let i = 0; i < Math.min(count, 6); i += 1) {
      sample.push(pos.getElement(i, []).map((n) => n.toFixed(2)));
    }
    console.log('sample:', JSON.stringify(sample));
  }
}
