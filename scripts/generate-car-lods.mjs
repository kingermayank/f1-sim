#!/usr/bin/env node
/**
 * Builds distance versions of the team cars: public/assets/models/cars-lod/.
 *
 * The runtime cars are 55-85k triangles each. Fourteen of them in view at a
 * race start is over a million triangles a frame before the circuit is
 * drawn. A car more than a few dozen metres away is a few hundred pixels
 * tall and cannot show that detail, so every rival beyond that distance
 * draws this version instead: about a tenth of the triangles and 256 px
 * textures.
 *
 * The seam-respecting simplifier barely touches these models (every UV seam
 * pins its vertices), so this uses meshoptimizer's sloppy simplifier, which
 * collapses by position only and remaps to existing vertices, keeping every
 * attribute valid.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const IN = resolve(ROOT, 'public/assets/models/cars');
const OUT = resolve(ROOT, 'public/assets/models/cars-lod');
const TARGET_RATIO = 0.1;
const TEXTURE_SIZE = 256;

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

mkdirSync(OUT, { recursive: true });

for (const file of readdirSync(IN).filter((name) => name.endsWith('.glb'))) {
  const document = await io.read(resolve(IN, file));
  let before = 0;
  let after = 0;

  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const position = primitive.getAttribute('POSITION');
      if (!indices || !position) continue;
      const source = new Uint32Array(indices.getArray());
      const positions = new Float32Array(position.getArray());
      before += source.length / 3;
      const target = Math.min(source.length, Math.max(12, Math.floor((source.length * TARGET_RATIO) / 3) * 3));
      const [simplified] = MeshoptSimplifier.simplifySloppy(source, positions, 3, null, target, 0.05);
      indices.setArray(simplified);
      after += simplified.length / 3;
    }
  }

  await document.transform(
    compactPrimitive.length ? (doc) => { for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) compactPrimitive(p); } : () => {},
    textureCompress({ encoder: sharp, resize: [TEXTURE_SIZE, TEXTURE_SIZE], targetFormat: 'webp' }),
  );
  // Write uncompressed: the decoded meshopt layout no longer matches the new
  // indices. `npm run cars:lod` recompresses the folder with the CLI after.
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'EXT_meshopt_compression') extension.dispose();
  }
  await io.write(resolve(OUT, file), document);
  console.log(`${file.padEnd(18)} ${Math.round(before).toString().padStart(7)} → ${Math.round(after).toString().padStart(6)} tris`);
}
