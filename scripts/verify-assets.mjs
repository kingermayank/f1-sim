import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const manifestPath = resolve('src/assets/credits.json');

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
      const runtimePath = resolve('public', asset.runtimeFile.replace(/^\/+/, ''));
      const publicRoot = resolve('public');
      if (!runtimePath.startsWith(`${publicRoot}/`) || !existsSync(runtimePath)) {
        problems.push(`${label}: runtime file not found: ${asset.runtimeFile}`);
      } else {
        if (runtimeFiles.has(asset.runtimeFile)) problems.push(`${label}: duplicate runtimeFile`);
        runtimeFiles.add(asset.runtimeFile);
        const bytes = readFileSync(runtimePath);
        const limit = asset.runtimeFile.endsWith('monaco-track.glb') ? 30_000_000
          : asset.runtimeFile.endsWith('f1-car.glb') ? 2_000_000 : 300_000;
        if (statSync(runtimePath).size > limit) problems.push(`${label}: runtime file exceeds ${limit} bytes`);
        if (asset.runtimeFile.endsWith('.glb') && bytes.subarray(0, 4).toString() !== 'glTF') {
          problems.push(`${label}: invalid GLB header`);
        }
        if (asset.runtimeFile.endsWith('.webp') && (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP')) {
          problems.push(`${label}: invalid WebP header`);
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
