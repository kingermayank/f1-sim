/**
 * Builds the APEX Shanghai circuit end to end:
 *
 *   1. lays it out from the game's centreline   (export-shanghai-layout.mjs)
 *   2. renders the APEX posters and signs          (render-posters.mjs)
 *   3. models it in Blender                        (build_shanghai_circuit.py)
 *   4. compresses it for the web                   (glTF Transform: meshopt, WebP)
 *   5. renders the sky over it in Blender           (render_sky.py)
 *
 * The results are public/assets/models/circuit/shanghai-apex.glb and
 * public/assets/textures/sky/shanghai-sky.webp.
 *
 * Blender: set BLENDER to a Blender executable (run headless), or
 * BLENDER_PYTHON to a Python with the `bpy` module installed
 * (`pip install bpy` on Python 3.13). Defaults to `blender` on the PATH.
 *
 * Usage: node scripts/circuit/build-circuit.mjs [--skip-layout] [--skip-posters] [--skip-blender] [--skip-sky]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BUILD = resolve(ROOT, 'work/track-build');
const OUT = resolve(ROOT, 'public/assets/models/circuit/shanghai-apex.glb');
const SKY_OUT = resolve(ROOT, 'public/assets/textures/sky/shanghai-sky.webp');
const args = new Set(process.argv.slice(2));

function run(command, commandArgs) {
  console.log(`\n$ ${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.error})`);
}

mkdirSync(BUILD, { recursive: true });
if (!args.has('--skip-layout')) run('node', ['scripts/circuit/export-shanghai-layout.mjs']);
if (!args.has('--skip-posters')) run('node', ['scripts/circuit/render-posters.mjs']);

function blender(script) {
  if (process.env.BLENDER_PYTHON) run(process.env.BLENDER_PYTHON, [script]);
  else run(process.env.BLENDER ?? 'blender', ['--background', '--factory-startup', '--python', script]);
}
if (args.has('--skip-blender')) console.log('\nUsing the existing Blender export.');
else blender('scripts/circuit/build_shanghai_circuit.py');

// Compress for the web. Keep the node tree and every material as they are:
// the game finds scenery by group and restyles surfaces by material name (each
// start light is its own material), so nothing may be flattened, joined, or
// merged because it happens to look the same.
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
});
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const document = await io.read(resolve(BUILD, 'shanghai-apex.glb'));
// Texture coordinates go only where a texture reads them, and on the debris
// fencing, whose chain-link pattern the game draws from them in metres.
const KEEP_UV = new Set(['apex_fence']);
function dropUnusedUvs(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial();
      const textured = material && (material.getBaseColorTexture() || material.getEmissiveTexture());
      if (!textured && !KEEP_UV.has(material?.getName())) primitive.setAttribute('TEXCOORD_0', null);
    }
  }
}
await document.transform(
  dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
  dropUnusedUvs,
  weld(),
  prune({ keepAttributes: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048] }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
mkdirSync(dirname(OUT), { recursive: true });
await io.write(OUT, document);
console.log(`\n${OUT}: ${(statSync(OUT).size / 1e6).toFixed(2)} MB, ${document.getRoot().listMaterials().length} materials`);

if (!args.has('--skip-sky')) {
  blender('scripts/circuit/render_sky.py');
  mkdirSync(dirname(SKY_OUT), { recursive: true });
  await sharp(resolve(BUILD, 'sky.png')).webp({ quality: 88, effort: 6 }).toFile(SKY_OUT);
  console.log(`${SKY_OUT}: ${(statSync(SKY_OUT).size / 1e6).toFixed(2)} MB`);
}
