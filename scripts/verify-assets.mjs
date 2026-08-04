import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const manifestPath = resolve('src/assets/credits.json');

if (!existsSync(manifestPath)) {
  console.log('No asset manifest yet; nothing to verify');
  process.exit(0);
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

  for (const [index, asset] of manifest.entries()) {
    const label = asset?.id || `entry ${index + 1}`;

    if (!asset?.id) problems.push(`${label}: missing id`);
    else if (ids.has(asset.id)) problems.push(`${label}: duplicate id`);
    else ids.add(asset.id);

    for (const field of ['source', 'license', 'runtimeFile']) {
      if (!asset?.[field]) problems.push(`${label}: missing ${field}`);
    }

    if (asset?.runtimeFile) {
      const runtimePath = resolve('public', asset.runtimeFile.replace(/^\/+/, ''));
      if (!runtimePath.startsWith(`${resolve('public')}/`) || !existsSync(runtimePath)) {
        problems.push(`${label}: runtime file not found: ${asset.runtimeFile}`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}

console.log(`Asset manifest verified: ${manifest.length} entries`);
