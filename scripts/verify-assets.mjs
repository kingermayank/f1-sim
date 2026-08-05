import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const manifestPath = resolve(process.env.ASSET_MANIFEST_PATH ?? 'src/assets/credits.json');
const publicRoot = resolve(process.env.ASSET_PUBLIC_ROOT ?? 'public');

function validateGlb(bytes) {
  if (bytes.length < 20 || bytes.subarray(0, 4).toString() !== 'glTF') return 'invalid GLB header';
  if (bytes.readUInt32LE(4) !== 2) return 'invalid GLB version';
  const declaredLength = bytes.readUInt32LE(8);
  if (declaredLength !== bytes.length) return 'invalid GLB declared length';

  let offset = 12;
  let chunkCount = 0;
  while (offset < declaredLength) {
    if (offset + 8 > declaredLength) return 'truncated GLB chunk header';
    const length = bytes.readUInt32LE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString();
    const chunkEnd = offset + 8 + length;
    if (chunkEnd > declaredLength) return 'GLB chunk exceeds declared length';
    if (!['JSON', 'BIN\0'].includes(type)) return `invalid GLB chunk type: ${JSON.stringify(type)}`;
    if (chunkCount === 0 && type !== 'JSON') return 'invalid GLB first chunk type';
    if (chunkCount > 0 && type === 'JSON') return 'invalid GLB JSON chunk order';
    if (type === 'JSON') {
      try {
        JSON.parse(bytes.subarray(offset + 8, chunkEnd).toString('utf8').replace(/[\0\s]+$/u, ''));
      } catch {
        return 'invalid GLB JSON chunk';
      }
    }
    offset = chunkEnd;
    chunkCount += 1;
  }
  return chunkCount === 0 ? 'missing GLB chunks' : undefined;
}

function parseWebpDimensions(bytes) {
  if (bytes.length < 12 || bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') {
    return { error: 'invalid WebP header' };
  }
  if (bytes.readUInt32LE(4) !== bytes.length - 8) return { error: 'invalid WebP RIFF length' };

  let offset = 12;
  let dimensions;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return { error: 'truncated WebP chunk header' };
    const type = bytes.subarray(offset, offset + 4).toString();
    const length = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const chunkEnd = dataStart + length;
    const paddedEnd = chunkEnd + (length % 2);
    if (paddedEnd > bytes.length) return { error: 'WebP chunk exceeds declared length' };
    const data = bytes.subarray(dataStart, chunkEnd);
    if (type === 'VP8X') {
      if (length < 10) return { error: 'invalid WebP VP8X chunk' };
      dimensions = {
        width: 1 + data[4] + (data[5] << 8) + (data[6] << 16),
        height: 1 + data[7] + (data[8] << 8) + (data[9] << 16),
      };
    } else if (type === 'VP8 ') {
      if (length < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) return { error: 'invalid WebP VP8 frame' };
      dimensions = { width: data.readUInt16LE(6) & 0x3fff, height: data.readUInt16LE(8) & 0x3fff };
    } else if (type === 'VP8L') {
      if (length < 5 || data[0] !== 0x2f) return { error: 'invalid WebP VP8L frame' };
      dimensions = {
        width: 1 + data[1] + ((data[2] & 0x3f) << 8),
        height: 1 + (data[2] >> 6) + (data[3] << 2) + ((data[4] & 0x0f) << 10),
      };
    }
    offset = paddedEnd;
  }
  return dimensions ?? { error: 'missing WebP image chunk' };
}

function decodeWebp(filePath) {
  const result = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return { error: 'WebP decoder rejected file' };
  const width = Number(result.stdout.match(/pixelWidth:\s*(\d+)/u)?.[1]);
  const height = Number(result.stdout.match(/pixelHeight:\s*(\d+)/u)?.[1]);
  return Number.isInteger(width) && Number.isInteger(height) ? { width, height } : { error: 'WebP decoder did not report dimensions' };
}

if (!existsSync(manifestPath)) {
  console.error('Asset manifest not found: src/assets/credits.json');
  process.exit(1);
}

const problems = [];
let manifest;

try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  problems.push(`Unable to parse asset manifest: ${error.message}`);
}

if (manifest && !Array.isArray(manifest)) {
  problems.push('Asset manifest must be an array');
}

if (Array.isArray(manifest)) {
  const ids = new Set();
  const runtimeFiles = new Set();
  const requiredRuntimeFiles = new Set([
    '/assets/models/monaco-track.glb',
    '/assets/models/f1-car.glb',
    ...['mercedes', 'ferrari', 'mclaren', 'red-bull', 'racing-bulls', 'alpine', 'haas', 'audi', 'williams', 'aston-martin', 'cadillac']
      .map((team) => `/assets/textures/teams/${team}.webp`),
  ]);

  if (manifest.length !== 13) {
    problems.push(`Asset manifest must contain 13 entries; found ${manifest.length}`);
  }

  for (const [index, asset] of manifest.entries()) {
    const label = asset?.id || `entry ${index + 1}`;

    if (!asset?.id) problems.push(`${label}: missing id`);
    else if (ids.has(asset.id)) problems.push(`${label}: duplicate id`);
    else ids.add(asset.id);

    for (const field of [
      'id', 'title', 'creator', 'source', 'license', 'licenseUrl',
      'downloadedAt', 'originalFile', 'runtimeFile', 'modifications',
    ]) {
      if (!asset?.[field]) problems.push(`${label}: missing ${field}`);
    }

    if (asset?.licenseUrl) {
      try {
        new URL(asset.licenseUrl);
      } catch {
        problems.push(`${label}: invalid licenseUrl`);
      }
    }

    if (asset?.originalFile && !asset.originalFile.startsWith('http') && !existsSync(resolve(asset.originalFile))) {
      problems.push(`${label}: original file not found: ${asset.originalFile}`);
    }

    if (asset?.runtimeFile) {
      const runtimePath = resolve(publicRoot, asset.runtimeFile.replace(/^\/+/, ''));
      if (!runtimePath.startsWith(`${publicRoot}/`) || !existsSync(runtimePath)) {
        problems.push(`${label}: runtime file not found: ${asset.runtimeFile}`);
      } else {
        if (runtimeFiles.has(asset.runtimeFile)) problems.push(`${label}: duplicate runtimeFile`);
        runtimeFiles.add(asset.runtimeFile);
        const bytes = readFileSync(runtimePath);
        const limit = asset.runtimeFile.endsWith('monaco-track.glb') ? 30_000_000
          : asset.runtimeFile.endsWith('f1-car.glb') ? 2_000_000 : 300_000;
        if (statSync(runtimePath).size > limit) problems.push(`${label}: runtime file exceeds ${limit} bytes`);
        if (asset.runtimeFile.endsWith('.glb')) {
          const problem = validateGlb(bytes);
          if (problem) problems.push(`${label}: ${problem}`);
        }
        if (asset.runtimeFile.endsWith('.webp')) {
          const parsed = parseWebpDimensions(bytes);
          const decoded = parsed.error ? parsed : decodeWebp(runtimePath);
          if (decoded.error) problems.push(`${label}: ${decoded.error}`);
          else if (asset.runtimeFile.includes('/textures/teams/') && (decoded.width !== 512 || decoded.height !== 512)) {
            problems.push(`${label}: livery dimensions must be 512x512; found ${decoded.width}x${decoded.height}`);
          }
        }
      }
    }
  }

  for (const runtimeFile of requiredRuntimeFiles) {
    if (!runtimeFiles.has(runtimeFile)) problems.push(`missing required runtime file: ${runtimeFile}`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}

console.log(`Asset manifest verified: ${manifest.length} entries`);
