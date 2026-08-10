import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import { TRACK_SOURCES } from '../../scripts/track-sources.mjs';

const EXPECTED_SOURCES = {
  suzuka: ['suzuka-circuit-2001-layout.zip', 'source/suzukibananini.glb'],
  melbourne: ['albert-park-circuit-melbourne-2018-layout.zip', 'source/melbourne.glb'],
  barcelona: ['barcelona-catalunya-grand-prix-2023-layout.zip', 'source/untitled.glb'],
  spa: ['circuit-de-spa-francorchamps-2022-layout.zip', 'source/spa.glb'],
  silverstone: ['silverstone-circuit-2024-layout.zip', 'source/silverstone.glb'],
  singapore: ['marina-bay-street-circuit.zip', 'source/singapore.glb'],
  'red-bull-ring': ['redbull-ring-2025-layout.zip', 'source/redbullring.glb'],
  austin: ['austin-circuit-of-the-americas-2012-layout.zip', 'source/Untitled_compressed.glb'],
  'abu-dhabi': ['yas-marina-circuit-abu-dhabi-2021-layout.zip', 'source/abudhabi_compressed.glb'],
  bahrain: ['bahrain-international-circuit.zip', 'source/bahrain.glb'],
} as const;

function archiveSnapshot(path: string) {
  const stat = statSync(path);
  return {
    bytes: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  };
}

const temporaryRoots: string[] = [];
const SUZUKA_WORK_ROOT = resolve('work/assets-source/tracks/suzuka');
const SUZUKA_PUBLIC_MODEL = resolve('public/assets/models/tracks/suzuka.glb');
const SUZUKA_PUBLIC_MANIFEST = resolve('public/assets/models/tracks/suzuka.manifest.json');

function runCli(script: string, args: string[] = [], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync('node', [`scripts/${script}`, ...args], { encoding: 'utf8', env });
}

function parseOnlyEnvelope(stdout: string) {
  const lines = stdout.trim().split(/\r?\n/u);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]);
}

function createSourceFixture() {
  const root = mkdtempSync(join(tmpdir(), 'track-pipeline-'));
  temporaryRoots.push(root);
  const modelDirectory = join(root, 'source');
  mkdirSync(modelDirectory);
  writeFileSync(join(modelDirectory, 'suzukibananini.glb'), createSemanticTrackGlb());
  const archive = join(root, 'suzuka-circuit-2001-layout.zip');
  const zipped = spawnSync('zip', ['-q', archive, 'source/suzukibananini.glb'], {
    cwd: root,
    encoding: 'utf8',
  });
  expect(zipped.status, zipped.stderr).toBe(0);
  return { archive, sourceRoot: root };
}

function createSemanticTrackGlb() {
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: 'VEC3',
      min: [0, 0, 0],
      max: [1, 1, 0],
    }],
    materials: [{ name: 'main-road' }, { name: 'pit-lane' }, { name: 'starting-grid' }],
    meshes: [{
      name: 'circuit-mesh',
      primitives: [0, 1, 2].map((material) => ({ attributes: { POSITION: 0 }, material })),
    }],
    nodes: [{ name: 'circuit-root', mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }));
  const jsonPadding = (4 - (json.length % 4)) % 4;
  const paddedJson = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);
  const totalLength = 12 + 8 + paddedJson.length + 8 + 36;
  const glb = Buffer.alloc(totalLength);
  glb.write('glTF', 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(totalLength, 8);
  glb.writeUInt32LE(paddedJson.length, 12);
  glb.write('JSON', 16);
  paddedJson.copy(glb, 20);
  const binHeader = 20 + paddedJson.length;
  glb.writeUInt32LE(36, binHeader);
  glb.write('BIN\0', binHeader + 4);
  const positions = new Float32Array(glb.buffer, glb.byteOffset + binHeader + 8, 9);
  positions.set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  return glb;
}

function expectPipelineData(data: Record<string, any>, circuitId: string, allowedRoot: string) {
  expect(data).toMatchObject({
    circuitId,
    source: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) },
    bounds: { min: [expect.any(Number), expect.any(Number), expect.any(Number)], max: [expect.any(Number), expect.any(Number), expect.any(Number)] },
    meshes: expect.any(Number),
    materials: expect.any(Number),
    triangles: expect.any(Number),
    detected: { road: expect.any(Array), pit: expect.any(Array), grid: expect.any(Array) },
    output: { path: expect.any(String), bytes: expect.any(Number) },
    warnings: expect.any(Array),
  });
  expect(resolve(data.output.path).startsWith(`${allowedRoot}/`)).toBe(true);
}

function verifyAssets(manifestPath: string, publicRoot: string) {
  return spawnSync('node', ['scripts/verify-assets.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, ASSET_MANIFEST_PATH: manifestPath, ASSET_PUBLIC_ROOT: publicRoot },
  });
}

function createLargeSemanticGlb(byteLength = 30_000_004) {
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: 'VEC3',
      min: [0, 0, 0],
      max: [0, 0, 0],
    }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }));
  const jsonPadding = (4 - (json.length % 4)) % 4;
  const paddedJson = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);
  const binPadding = (4 - (byteLength % 4)) % 4;
  const totalLength = 12 + 8 + paddedJson.length + 8 + byteLength + binPadding;
  const glb = Buffer.alloc(totalLength);
  glb.write('glTF', 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(totalLength, 8);
  glb.writeUInt32LE(paddedJson.length, 12);
  glb.write('JSON', 16);
  paddedJson.copy(glb, 20);
  const binHeader = 20 + paddedJson.length;
  glb.writeUInt32LE(byteLength + binPadding, binHeader);
  glb.write('BIN\0', binHeader + 4);
  return glb;
}

afterEach(() => {
  rmSync(SUZUKA_WORK_ROOT, { recursive: true, force: true });
  rmSync(SUZUKA_PUBLIC_MODEL, { force: true });
  rmSync(SUZUKA_PUBLIC_MANIFEST, { force: true });
  while (temporaryRoots.length) rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
});

describe('track source inventory', () => {
  it('maps ten unique immutable circuit IDs to the supplied archives and model entries without mutating them', () => {
    expect(Object.isFrozen(TRACK_SOURCES)).toBe(true);
    expect(Object.keys(TRACK_SOURCES)).toEqual(Object.keys(EXPECTED_SOURCES));
    expect(new Set(Object.keys(TRACK_SOURCES)).size).toBe(10);

    for (const [id, [archiveName, modelEntry]] of Object.entries(EXPECTED_SOURCES)) {
      const source = TRACK_SOURCES[id as keyof typeof TRACK_SOURCES];
      expect(basename(source.archive)).toBe(archiveName);
      expect(source.model).toBe(modelEntry);

      const before = archiveSnapshot(source.archive);
      const entries = spawnSync('unzip', ['-Z1', source.archive], { encoding: 'utf8' });
      expect(entries.status, entries.stderr).toBe(0);
      expect(entries.stdout.split(/\r?\n/u)).toContain(modelEntry);
      expect(archiveSnapshot(source.archive)).toEqual(before);
    }
  }, 30_000);
});

describe('track pipeline CLI contract', () => {
  it.each([
    'analyze-track-geometry.mjs',
    'optimize-track.mjs',
    'generate-track.mjs',
  ])('%s rejects missing, unknown, and traversal-style circuit IDs with one JSON envelope', (script) => {
    for (const args of [[], ['--circuit', 'not-a-circuit'], ['--circuit', '../../outside']]) {
      const result = runCli(script, args);
      expect(result.status).toBe(1);
      const envelope = parseOnlyEnvelope(result.stdout);
      expect(envelope).toMatchObject({ schemaVersion: 1, ok: false });
      expect(envelope.command).toMatch(/^(analyze|optimize|generate)$/u);
      expect(envelope.error).toMatchObject({ code: expect.any(String), message: expect.any(String) });
      expect(result.stderr).not.toBe('');
    }
  });

  it('analyzes, optimizes, and generates one source while preserving the archive and output boundaries', () => {
    const fixture = createSourceFixture();
    const sourceBefore = archiveSnapshot(fixture.archive);
    const env = { ...process.env, TRACK_SOURCE_ROOT: fixture.sourceRoot };

    const analyzed = runCli('analyze-track-geometry.mjs', ['--circuit', 'suzuka'], env);
    expect(analyzed.status, analyzed.stderr).toBe(0);
    const analyzeEnvelope = parseOnlyEnvelope(analyzed.stdout);
    expect(analyzeEnvelope).toMatchObject({ schemaVersion: 1, ok: true, command: 'analyze' });
    expectPipelineData(analyzeEnvelope.data, 'suzuka', resolve('work/assets-source/tracks'));
    expect(analyzeEnvelope.data.detected).toEqual({
      road: ['main-road'],
      pit: ['pit-lane'],
      grid: ['starting-grid'],
    });

    const optimized = runCli('optimize-track.mjs', ['--circuit', 'suzuka'], env);
    expect(optimized.status, optimized.stderr).toBe(0);
    const optimizeEnvelope = parseOnlyEnvelope(optimized.stdout);
    expect(optimizeEnvelope).toMatchObject({ schemaVersion: 1, ok: true, command: 'optimize' });
    expectPipelineData(optimizeEnvelope.data, 'suzuka', resolve('work/assets-source/tracks'));

    const generated = runCli('generate-track.mjs', ['--circuit', 'suzuka'], env);
    expect(generated.status, generated.stderr).toBe(0);
    const generateEnvelope = parseOnlyEnvelope(generated.stdout);
    expect(generateEnvelope).toMatchObject({ schemaVersion: 1, ok: true, command: 'generate' });
    expectPipelineData(generateEnvelope.data, 'suzuka', resolve('public/assets/models/tracks'));

    const runtime = readFileSync(SUZUKA_PUBLIC_MODEL);
    expect(runtime.subarray(0, 4).toString()).toBe('glTF');
    expect(runtime.readUInt32LE(4)).toBe(2);
    expect(runtime.readUInt32LE(8)).toBe(runtime.length);
    const manifest = JSON.parse(readFileSync(SUZUKA_PUBLIC_MANIFEST, 'utf8'));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      circuitId: 'suzuka',
      source: { sha256: sourceBefore.sha256 },
      output: {
        runtimeFile: '/assets/models/tracks/suzuka.glb',
        bytes: runtime.length,
        sha256: createHash('sha256').update(runtime).digest('hex'),
      },
    });
    expect(archiveSnapshot(fixture.archive)).toEqual(sourceBefore);
  }, 30_000);
});

describe('runtime track asset verification', () => {
  it('requires matching credits/manifests and enforces the 30 MB limit unless an exception is explicit', () => {
    const fixture = createSourceFixture();
    const env = { ...process.env, TRACK_SOURCE_ROOT: fixture.sourceRoot };
    const generated = runCli('generate-track.mjs', ['--circuit', 'suzuka'], env);
    expect(generated.status, generated.stderr).toBe(0);

    const verificationRoot = mkdtempSync(join(tmpdir(), 'track-verifier-'));
    temporaryRoots.push(verificationRoot);
    const publicRoot = join(verificationRoot, 'public');
    cpSync('public', publicRoot, { recursive: true });
    const manifestPath = join(verificationRoot, 'credits.json');
    const baseCredits = JSON.parse(readFileSync('src/assets/credits.json', 'utf8'));
    writeFileSync(manifestPath, JSON.stringify(baseCredits));

    const missingCredit = verifyAssets(manifestPath, publicRoot);
    expect(missingCredit.status).toBe(1);
    expect(missingCredit.stderr).toMatch(/suzuka.*explicit credit/iu);

    const generatedManifestPath = join(publicRoot, 'assets/models/tracks/suzuka.manifest.json');
    const generatedManifest = JSON.parse(readFileSync(generatedManifestPath, 'utf8'));
    const trackCredit = {
      id: 'track-suzuka',
      circuitId: 'suzuka',
      title: 'Suzuka Circuit - 2001 layout',
      creator: 'UNRECORDED - local prototype source',
      source: 'User-supplied Sketchfab archive',
      sourceSha256: generatedManifest.source.sha256,
      license: 'UNVERIFIED - local prototype use only',
      licenseUrl: 'https://sketchfab.com/licenses',
      downloadedAt: '2026-08-09 (supplied by the project owner)',
      originalFile: fixture.archive,
      runtimeFile: '/assets/models/tracks/suzuka.glb',
      modifications: 'Generated with scripts/generate-track.mjs for local prototype use.',
    };
    writeFileSync(manifestPath, JSON.stringify([...baseCredits, trackCredit]));
    const matching = verifyAssets(manifestPath, publicRoot);
    expect(matching.status, matching.stderr).toBe(0);

    rmSync(generatedManifestPath);
    const missingManifest = verifyAssets(manifestPath, publicRoot);
    expect(missingManifest.status).toBe(1);
    expect(missingManifest.stderr).toMatch(/suzuka.*generated manifest/iu);

    writeFileSync(generatedManifestPath, JSON.stringify({
      ...generatedManifest,
      output: { ...generatedManifest.output, sha256: '0'.repeat(64) },
    }));
    const mismatchedManifest = verifyAssets(manifestPath, publicRoot);
    expect(mismatchedManifest.status).toBe(1);
    expect(mismatchedManifest.stderr).toMatch(/suzuka.*checksum/iu);

    const runtimePath = join(publicRoot, 'assets/models/tracks/suzuka.glb');
    const largeRuntime = createLargeSemanticGlb();
    writeFileSync(runtimePath, largeRuntime);
    const largeManifest = {
      ...generatedManifest,
      output: {
        ...generatedManifest.output,
        bytes: largeRuntime.length,
        sha256: createHash('sha256').update(largeRuntime).digest('hex'),
      },
    };
    writeFileSync(generatedManifestPath, JSON.stringify(largeManifest));
    const oversized = verifyAssets(manifestPath, publicRoot);
    expect(oversized.status).toBe(1);
    expect(oversized.stderr).toMatch(/suzuka.*exceeds 30000000 bytes/iu);

    const exception = 'Source landmark geometry requires a larger local prototype payload.';
    writeFileSync(manifestPath, JSON.stringify([...baseCredits, {
      ...trackCredit,
      maxRuntimeBytes: largeRuntime.length,
      runtimeSizeException: exception,
    }]));
    writeFileSync(generatedManifestPath, JSON.stringify({
      ...largeManifest,
      limits: { maxBytes: largeRuntime.length, exception },
    }));
    const documentedException = verifyAssets(manifestPath, publicRoot);
    expect(documentedException.status, documentedException.stderr).toBe(0);
  }, 45_000);
});
