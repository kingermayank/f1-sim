import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Logger, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getGLPrimitiveCount } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';

import {
  TRACK_WORK_ROOT,
  TrackPipelineError,
  assertPathInside,
  isMainModule,
  resolveCircuitArgs,
  runJsonCommand,
} from './track-sources.mjs';

const DEFAULT_MAX_ZIP_ENTRY_BYTES = 512 * 1024 * 1024;
const testMaxZipEntryBytes = process.env.NODE_ENV === 'test'
  ? Number(process.env.TRACK_PIPELINE_TEST_MAX_ZIP_ENTRY_BYTES)
  : Number.NaN;
const MAX_ZIP_ENTRY_BYTES = Number.isSafeInteger(testMaxZipEntryBytes) && testMaxZipEntryBytes > 0
  ? testMaxZipEntryBytes
  : DEFAULT_MAX_ZIP_ENTRY_BYTES;

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function archiveState(path) {
  const stat = statSync(path);
  return { bytes: stat.size, mtimeMs: stat.mtimeMs };
}

async function preserveArchiveCopy(archive, output) {
  const temporary = `${output}.tmp-${process.pid}`;
  const sourceStat = statSync(archive);
  mkdirSync(dirname(output), { recursive: true });
  rmSync(temporary, { force: true });
  try {
    copyFileSync(archive, temporary);
    utimesSync(temporary, sourceStat.atimeMs / 1_000, sourceStat.mtimeMs / 1_000);
    renameSync(temporary, output);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function assertArchiveAndEntry(source) {
  if (!existsSync(source.archive) || !statSync(source.archive).isFile()) {
    throw new TrackPipelineError('SOURCE_ARCHIVE_MISSING', `Source archive not found: ${source.archive}`);
  }
  const listed = spawnSync('unzip', ['-Z1', source.archive], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (listed.error) throw new TrackPipelineError('UNZIP_UNAVAILABLE', listed.error.message);
  if (listed.status !== 0) {
    throw new TrackPipelineError('SOURCE_ARCHIVE_INVALID', listed.stderr.trim() || `Unable to inspect ${source.archive}`);
  }
  if (!listed.stdout.split(/\r?\n/u).includes(source.model)) {
    throw new TrackPipelineError('SOURCE_MODEL_MISSING', `Archive does not contain declared model entry: ${source.model}`);
  }
}

async function extractZipEntry(archive, entry, output) {
  const temporary = `${output}.tmp-${process.pid}`;
  mkdirSync(dirname(output), { recursive: true });
  rmSync(temporary, { force: true });

  const child = spawn('unzip', ['-p', archive, entry], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr = [];
  let stderrBytes = 0;
  child.stderr.on('data', (chunk) => {
    if (stderrBytes < 64 * 1024) stderr.push(chunk);
    stderrBytes += chunk.length;
  });
  let exitCode;
  const completed = new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      exitCode = code;
      accept();
    });
  });
  let extractedBytes = 0;
  const sizeLimit = new Transform({
    transform(chunk, _encoding, callback) {
      extractedBytes += chunk.length;
      if (extractedBytes > MAX_ZIP_ENTRY_BYTES) {
        callback(new TrackPipelineError(
          'SOURCE_MODEL_TOO_LARGE',
          `Source model exceeds ${MAX_ZIP_ENTRY_BYTES} bytes`,
        ));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await Promise.all([
      pipeline(child.stdout, sizeLimit, createWriteStream(temporary, { flags: 'wx' })),
      completed,
    ]);
    if (exitCode !== 0) {
      throw new TrackPipelineError('SOURCE_EXTRACTION_FAILED', Buffer.concat(stderr).toString('utf8').trim() || `unzip exited ${exitCode}`);
    }
    if (statSync(temporary).size > MAX_ZIP_ENTRY_BYTES) {
      throw new TrackPipelineError('SOURCE_MODEL_TOO_LARGE', `Source model exceeds ${MAX_ZIP_ENTRY_BYTES} bytes`);
    }
    renameSync(temporary, output);
  } catch (error) {
    child.kill('SIGKILL');
    await completed.catch(() => {});
    rmSync(temporary, { force: true });
    throw error;
  }
}

export async function stageTrackSource(id, source) {
  assertArchiveAndEntry(source);
  const stateBefore = archiveState(source.archive);
  const sourceSha256 = await sha256File(source.archive);
  const archiveCopy = assertPathInside(
    TRACK_WORK_ROOT,
    resolve(TRACK_WORK_ROOT, id, 'original', basename(source.archive)),
  );
  const output = assertPathInside(
    TRACK_WORK_ROOT,
    resolve(TRACK_WORK_ROOT, id, 'original', source.model),
  );

  await preserveArchiveCopy(source.archive, archiveCopy);
  await extractZipEntry(source.archive, source.model, output);

  const stateAfter = archiveState(source.archive);
  const checksumAfter = await sha256File(source.archive);
  if (stateAfter.bytes !== stateBefore.bytes || stateAfter.mtimeMs !== stateBefore.mtimeMs || checksumAfter !== sourceSha256) {
    throw new TrackPipelineError('SOURCE_ARCHIVE_MUTATED', `Source archive changed while processing: ${source.archive}`);
  }

  return { archiveCopy, output, sourceSha256 };
}

async function createIo() {
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'meshopt.decoder': MeshoptDecoder,
    });
}

function combinedBounds(scenes) {
  const bounds = scenes.map((scene) => getBounds(scene));
  if (bounds.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  return bounds.reduce((total, current) => ({
    min: total.min.map((value, index) => Math.min(value, current.min[index])),
    max: total.max.map((value, index) => Math.max(value, current.max[index])),
  }));
}

function detectSemanticNames(properties, pattern) {
  return [...new Set(properties.map((property) => property.getName()).filter((name) => name && pattern.test(name)))].sort();
}

export async function inspectTrackGlb(path) {
  const io = await createIo();
  const document = await io.read(path);
  document.setLogger(new Logger(Logger.Verbosity.SILENT));
  const root = document.getRoot();
  // Sketchfab exports are inconsistent about where meaningful labels live:
  // some use nodes, while others (including Suzuka) name only materials.
  const namedProperties = [...root.listNodes(), ...root.listMeshes(), ...root.listMaterials()];
  const detected = {
    road: detectSemanticNames(namedProperties, /(?:road|track|tarmac|race.?line|asphalt|surface)/iu),
    pit: detectSemanticNames(namedProperties, /pit/iu),
    grid: detectSemanticNames(namedProperties, /(?:grid|start.?finish)/iu),
  };
  const warnings = [];
  for (const category of ['road', 'pit', 'grid']) {
    if (detected[category].length === 0) warnings.push(`No ${category} nodes detected`);
  }
  return {
    bounds: combinedBounds(root.listScenes()),
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    triangles: root.listMeshes().reduce(
      (meshTotal, mesh) => meshTotal + mesh.listPrimitives().reduce(
        (primitiveTotal, primitive) => primitiveTotal + (primitive.getMode() === 4 ? getGLPrimitiveCount(primitive) : 0),
        0,
      ),
      0,
    ),
    detected,
    warnings,
  };
}

export async function analyzeCircuit(id, source) {
  const staged = await stageTrackSource(id, source);
  const inspection = await inspectTrackGlb(staged.output);
  return {
    circuitId: id,
    source: {
      archive: source.archive,
      stagedArchive: staged.archiveCopy,
      model: source.model,
      sha256: staged.sourceSha256,
    },
    ...inspection,
    output: {
      path: staged.output,
      bytes: statSync(staged.output).size,
      sha256: await sha256File(staged.output),
    },
  };
}

export async function analyzeTrack(args = process.argv.slice(2)) {
  const { id, source } = resolveCircuitArgs(args);
  return analyzeCircuit(id, source);
}

if (isMainModule(import.meta.url)) {
  await runJsonCommand('analyze', () => analyzeTrack());
}
