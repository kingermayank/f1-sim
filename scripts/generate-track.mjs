import {
  copyFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

import {
  TRACK_PUBLIC_ROOT,
  TrackPipelineError,
  assertPathInside,
  isMainModule,
  resolveCircuitArgs,
  runJsonCommand,
} from './track-sources.mjs';
import { sha256File } from './analyze-track-geometry.mjs';
import { optimizeCircuit } from './optimize-track.mjs';

export const DEFAULT_TRACK_LIMIT_BYTES = 30_000_000;

export async function generateCircuit(id, source) {
  const optimized = await optimizeCircuit(id, source);
  if (optimized.output.bytes > DEFAULT_TRACK_LIMIT_BYTES) {
    throw new TrackPipelineError(
      'RUNTIME_LIMIT_EXCEEDED',
      `${id} runtime model exceeds ${DEFAULT_TRACK_LIMIT_BYTES} bytes; document an explicit exception before registration`,
    );
  }

  const output = assertPathInside(TRACK_PUBLIC_ROOT, resolve(TRACK_PUBLIC_ROOT, `${id}.glb`));
  const manifestPath = assertPathInside(TRACK_PUBLIC_ROOT, resolve(TRACK_PUBLIC_ROOT, `${id}.manifest.json`));
  const temporaryOutput = `${output}.tmp-${process.pid}`;
  const temporaryManifest = `${manifestPath}.tmp-${process.pid}`;
  mkdirSync(TRACK_PUBLIC_ROOT, { recursive: true });
  rmSync(temporaryOutput, { force: true });
  rmSync(temporaryManifest, { force: true });

  copyFileSync(optimized.output.path, temporaryOutput);
  const outputSha256 = await sha256File(temporaryOutput);
  const outputBytes = statSync(temporaryOutput).size;
  const runtimeFile = `/assets/models/tracks/${id}.glb`;
  const manifest = {
    schemaVersion: 1,
    circuitId: id,
    source: {
      archive: source.archive,
      model: source.model,
      sha256: optimized.source.sha256,
    },
    output: {
      runtimeFile,
      bytes: outputBytes,
      sha256: outputSha256,
    },
    limits: {
      maxBytes: DEFAULT_TRACK_LIMIT_BYTES,
      exception: null,
    },
    inspection: {
      bounds: optimized.bounds,
      meshes: optimized.meshes,
      materials: optimized.materials,
      triangles: optimized.triangles,
      detected: optimized.detected,
      warnings: optimized.warnings,
    },
  };
  writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporaryOutput, output);
  renameSync(temporaryManifest, manifestPath);

  return {
    circuitId: id,
    source: optimized.source,
    bounds: optimized.bounds,
    meshes: optimized.meshes,
    materials: optimized.materials,
    triangles: optimized.triangles,
    detected: optimized.detected,
    output: {
      path: output,
      bytes: outputBytes,
      sha256: outputSha256,
      manifestPath,
      runtimeFile,
    },
    warnings: optimized.warnings,
  };
}

export async function generateTrack(args = process.argv.slice(2)) {
  const { id, source } = resolveCircuitArgs(args);
  return generateCircuit(id, source);
}

if (isMainModule(import.meta.url)) {
  await runJsonCommand('generate', () => generateTrack());
}
