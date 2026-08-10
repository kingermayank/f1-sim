import {
  copyFileSync,
  existsSync,
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

function publishPair(temporaryOutput, output, temporaryManifest, manifestPath) {
  const backupOutput = `${output}.backup-${process.pid}`;
  const backupManifest = `${manifestPath}.backup-${process.pid}`;
  let outputBackedUp = false;
  let manifestBackedUp = false;
  let outputPublished = false;
  let manifestPublished = false;
  rmSync(backupOutput, { force: true });
  rmSync(backupManifest, { force: true });

  try {
    assertPathInside(TRACK_PUBLIC_ROOT, output);
    assertPathInside(TRACK_PUBLIC_ROOT, manifestPath);
    if (existsSync(output)) {
      renameSync(output, backupOutput);
      outputBackedUp = true;
    }
    if (existsSync(manifestPath)) {
      renameSync(manifestPath, backupManifest);
      manifestBackedUp = true;
    }

    renameSync(temporaryOutput, output);
    outputPublished = true;
    if (process.env.NODE_ENV === 'test' && process.env.TRACK_PIPELINE_TEST_FAIL_PUBLISH_AFTER_MODEL === '1') {
      throw new Error('Injected paired-publication failure');
    }
    renameSync(temporaryManifest, manifestPath);
    manifestPublished = true;

    rmSync(backupOutput, { force: true });
    rmSync(backupManifest, { force: true });
  } catch (error) {
    let rollbackError;
    try {
      if (outputPublished) rmSync(output, { force: true });
      if (manifestPublished) rmSync(manifestPath, { force: true });
      if (outputBackedUp) renameSync(backupOutput, output);
      if (manifestBackedUp) renameSync(backupManifest, manifestPath);
    } catch (caught) {
      rollbackError = caught;
    }
    const detail = rollbackError
      ? `${error instanceof Error ? error.message : String(error)}; rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
      : error instanceof Error ? error.message : String(error);
    throw new TrackPipelineError('PUBLISH_FAILED', `Unable to publish track model and manifest together: ${detail}`);
  } finally {
    rmSync(temporaryOutput, { force: true });
    rmSync(temporaryManifest, { force: true });
  }
}

function resolveGenerateArgs(args) {
  const { id, source } = resolveCircuitArgs(args.slice(0, 2));
  if (args.length === 2) return { id, source, sizeException: null };
  if (args.length !== 6
    || args[2] !== '--max-runtime-bytes'
    || args[4] !== '--runtime-size-exception') {
    throw new TrackPipelineError(
      'INVALID_ARGUMENTS',
      'Expected: --circuit <circuit-id> [--max-runtime-bytes <bytes> --runtime-size-exception <rationale>]',
    );
  }
  const maxBytes = Number(args[3]);
  const rationale = args[5]?.trim();
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= DEFAULT_TRACK_LIMIT_BYTES || !rationale) {
    throw new TrackPipelineError(
      'INVALID_RUNTIME_SIZE_EXCEPTION',
      `Runtime size exception must include a max above ${DEFAULT_TRACK_LIMIT_BYTES} bytes and a rationale`,
    );
  }
  return { id, source, sizeException: { circuitId: id, maxBytes, rationale } };
}

export async function generateCircuit(id, source, sizeException = null) {
  const optimized = await optimizeCircuit(id, source);
  if (optimized.output.bytes > DEFAULT_TRACK_LIMIT_BYTES && !sizeException) {
    throw new TrackPipelineError(
      'RUNTIME_LIMIT_EXCEEDED',
      `${id} runtime model exceeds ${DEFAULT_TRACK_LIMIT_BYTES} bytes; document an explicit exception before registration`,
    );
  }
  if (sizeException && sizeException.circuitId !== id) {
    throw new TrackPipelineError('INVALID_RUNTIME_SIZE_EXCEPTION', 'Runtime size exception must match the requested circuit');
  }
  if (sizeException && optimized.output.bytes <= DEFAULT_TRACK_LIMIT_BYTES) {
    throw new TrackPipelineError(
      'RUNTIME_SIZE_EXCEPTION_NOT_REQUIRED',
      `${id} is within the default ${DEFAULT_TRACK_LIMIT_BYTES}-byte limit`,
    );
  }
  if (sizeException && optimized.output.bytes > sizeException.maxBytes) {
    throw new TrackPipelineError(
      'RUNTIME_EXCEPTION_LIMIT_EXCEEDED',
      `${id} runtime model exceeds its documented ${sizeException.maxBytes}-byte exception`,
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
      stagedArchive: optimized.source.stagedArchive,
      model: source.model,
      sha256: optimized.source.sha256,
    },
    output: {
      runtimeFile,
      bytes: outputBytes,
      sha256: outputSha256,
    },
    limits: {
      defaultMaxBytes: DEFAULT_TRACK_LIMIT_BYTES,
      maxBytes: sizeException?.maxBytes ?? DEFAULT_TRACK_LIMIT_BYTES,
      exception: sizeException?.rationale ?? null,
      exceptionCircuitId: sizeException?.circuitId ?? null,
    },
    licensing: {
      status: 'UNVERIFIED',
      usage: 'local-prototype-only',
      publishingAllowed: false,
      sourcePage: null,
      licenseUrl: null,
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
  publishPair(temporaryOutput, output, temporaryManifest, manifestPath);

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
  const { id, source, sizeException } = resolveGenerateArgs(args);
  return generateCircuit(id, source, sizeException);
}

if (isMainModule(import.meta.url)) {
  await runJsonCommand('generate', () => generateTrack());
}
