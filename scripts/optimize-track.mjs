import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
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

function isInsideTemporaryRoot(path) {
  const temporaryRoot = realpathSync(tmpdir());
  const child = relative(temporaryRoot, path);
  return child !== '..' && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`);
}

function resolveOptimizer() {
  if (process.env.NODE_ENV === 'test' && process.env.TRACK_PIPELINE_TEST_OPTIMIZER) {
    let candidate;
    try {
      candidate = realpathSync(resolve(process.env.TRACK_PIPELINE_TEST_OPTIMIZER));
    } catch {
      throw new TrackPipelineError(
        'OPTIMIZER_MISSING',
        `Injected optimizer not found: ${resolve(process.env.TRACK_PIPELINE_TEST_OPTIMIZER)}`,
      );
    }
    if (isInsideTemporaryRoot(candidate)) return candidate;
    throw new TrackPipelineError(
      'UNSAFE_TEST_OPTIMIZER',
      'TRACK_PIPELINE_TEST_OPTIMIZER must resolve beneath the operating-system temp directory',
    );
  }
  return resolve(PROJECT_ROOT, 'node_modules/.bin/gltf-transform');
}

function optimizerWarnings(result) {
  return [result.stdout, result.stderr]
    .flatMap((diagnostic) => diagnostic?.split(/\r?\n/u) ?? [])
    .map((diagnostic) => diagnostic.trim())
    .filter(Boolean)
    .map((diagnostic) => `Optimizer: ${diagnostic}`);
}

export async function optimizeCircuit(id, source) {
  const gltfTransform = resolveOptimizer();
  if (!existsSync(gltfTransform)) {
    throw new TrackPipelineError('OPTIMIZER_MISSING', `gltf-transform executable not found: ${gltfTransform}`);
  }
  const staged = await stageTrackSource(id, source);
  const output = assertPathInside(TRACK_WORK_ROOT, resolve(TRACK_WORK_ROOT, id, 'optimized', `${id}.glb`));
  const temporary = `${output}.tmp-${process.pid}.glb`;
  mkdirSync(dirname(output), { recursive: true });
  rmSync(temporary, { force: true });

  const optimized = spawnSync(gltfTransform, [
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
  const diagnostics = optimizerWarnings(optimized);
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
      stagedArchive: staged.archiveCopy,
      model: source.model,
      sha256: staged.sourceSha256,
    },
    ...inspection,
    warnings: [...inspection.warnings, ...diagnostics],
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
