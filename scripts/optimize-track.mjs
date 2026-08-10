import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  PROJECT_ROOT,
  TRACK_WORK_ROOT,
  TrackPipelineError,
  assertPathInside,
  isMainModule,
  resolveCircuitArgs,
  runJsonCommand,
} from './track-sources.mjs';
import { inspectTrackGlb, sha256File, stageTrackSource } from './analyze-track-geometry.mjs';

const GLTF_TRANSFORM = resolve(PROJECT_ROOT, 'node_modules/.bin/gltf-transform');

export async function optimizeCircuit(id, source) {
  const staged = await stageTrackSource(id, source);
  const output = assertPathInside(TRACK_WORK_ROOT, resolve(TRACK_WORK_ROOT, id, 'optimized', `${id}.glb`));
  const temporary = `${output}.tmp-${process.pid}.glb`;
  mkdirSync(dirname(output), { recursive: true });
  rmSync(temporary, { force: true });

  if (!existsSync(GLTF_TRANSFORM)) {
    throw new TrackPipelineError('OPTIMIZER_MISSING', `gltf-transform executable not found: ${GLTF_TRANSFORM}`);
  }
  const optimized = spawnSync(GLTF_TRANSFORM, [
    'optimize',
    staged.output,
    temporary,
    '--compress', 'meshopt',
    '--simplify', 'true',
    '--simplify-error', '0.001',
    '--texture-compress', 'webp',
    '--texture-size', '1024',
  ], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (optimized.stdout?.trim()) console.error(optimized.stdout.trim());
  if (optimized.stderr?.trim()) console.error(optimized.stderr.trim());
  if (optimized.error) {
    rmSync(temporary, { force: true });
    throw new TrackPipelineError('OPTIMIZATION_FAILED', optimized.error.message);
  }
  if (optimized.status !== 0 || !existsSync(temporary)) {
    rmSync(temporary, { force: true });
    throw new TrackPipelineError('OPTIMIZATION_FAILED', `gltf-transform exited ${optimized.status}`);
  }
  renameSync(temporary, output);

  const inspection = await inspectTrackGlb(output);
  return {
    circuitId: id,
    source: {
      archive: source.archive,
      model: source.model,
      sha256: staged.sourceSha256,
    },
    ...inspection,
    output: {
      path: output,
      bytes: statSync(output).size,
      sha256: await sha256File(output),
    },
  };
}

export async function optimizeTrack(args = process.argv.slice(2)) {
  const { id, source } = resolveCircuitArgs(args);
  return optimizeCircuit(id, source);
}

if (isMainModule(import.meta.url)) {
  await runJsonCommand('optimize', () => optimizeTrack());
}
