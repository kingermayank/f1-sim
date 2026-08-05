import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const manifestPath = resolve(process.env.ASSET_MANIFEST_PATH ?? 'src/assets/credits.json');
const publicRoot = resolve(process.env.ASSET_PUBLIC_ROOT ?? 'public');

const COMPONENT_BYTES = new Map([
  [5120, 1], [5121, 1], [5122, 2], [5123, 2], [5125, 4], [5126, 4],
]);
const TYPE_COMPONENTS = new Map([
  ['SCALAR', 1], ['VEC2', 2], ['VEC3', 3], ['VEC4', 4],
  ['MAT2', 4], ['MAT3', 9], ['MAT4', 16],
]);

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateGltfSemantics(gltf, binLength) {
  if (!Array.isArray(gltf.buffers) || gltf.buffers.length !== 1) return 'GLB must contain exactly one embedded buffer';
  const [buffer] = gltf.buffers;
  if (!isNonNegativeInteger(buffer?.byteLength) || buffer.byteLength > binLength) return 'invalid GLB buffer byteLength';
  if (buffer.uri) return 'GLB buffer must not reference an external URI';

  const bufferViews = gltf.bufferViews ?? [];
  if (!Array.isArray(bufferViews)) return 'invalid GLB bufferViews';
  for (const [index, view] of bufferViews.entries()) {
    const offset = view?.byteOffset ?? 0;
    if (!Number.isInteger(view?.buffer) || view.buffer !== 0) return `bufferView ${index} references an invalid buffer`;
    if (!isNonNegativeInteger(offset) || !isNonNegativeInteger(view?.byteLength) || offset + view.byteLength > buffer.byteLength) {
      return `bufferView ${index} exceeds buffer byteLength`;
    }
    if (view.byteStride !== undefined && (!Number.isInteger(view.byteStride) || view.byteStride < 4 || view.byteStride > 252 || view.byteStride % 4 !== 0)) {
      return `bufferView ${index} has invalid byteStride`;
    }
  }

  const accessors = gltf.accessors ?? [];
  if (!Array.isArray(accessors)) return 'invalid GLB accessors';
  for (const [index, accessor] of accessors.entries()) {
    const componentBytes = COMPONENT_BYTES.get(accessor?.componentType);
    const componentCount = TYPE_COMPONENTS.get(accessor?.type);
    if (!componentBytes) return `accessor ${index} has invalid componentType`;
    if (!componentCount) return `accessor ${index} has invalid type`;
    if (!isNonNegativeInteger(accessor?.count)) return `accessor ${index} has invalid count`;
    if (!Number.isInteger(accessor?.bufferView) || !bufferViews[accessor.bufferView]) return `accessor ${index} references an invalid bufferView`;

    const view = bufferViews[accessor.bufferView];
    const offset = accessor.byteOffset ?? 0;
    const elementBytes = componentBytes * componentCount;
    const stride = view.byteStride ?? elementBytes;
    if (!isNonNegativeInteger(offset) || offset % componentBytes !== 0) return `accessor ${index} has invalid byteOffset`;
    if (stride < elementBytes || stride % componentBytes !== 0) return `accessor ${index} has invalid stride`;
    const requiredBytes = accessor.count === 0 ? 0 : ((accessor.count - 1) * stride) + elementBytes;
    if (offset + requiredBytes > view.byteLength) return `accessor ${index} exceeds bufferView byteLength`;
  }

  const meshes = gltf.meshes ?? [];
  if (!Array.isArray(meshes)) return 'invalid GLB meshes';
  for (const [meshIndex, mesh] of meshes.entries()) {
    if (!Array.isArray(mesh?.primitives)) return `mesh ${meshIndex} has invalid primitives`;
    for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
      const attributes = primitive?.attributes;
      if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes) || Object.keys(attributes).length === 0) {
        return `mesh ${meshIndex} primitive ${primitiveIndex} has no attributes`;
      }
      let attributeCount;
      for (const accessorIndex of Object.values(attributes)) {
        if (!Number.isInteger(accessorIndex) || !accessors[accessorIndex]) return `mesh ${meshIndex} primitive ${primitiveIndex} references an invalid attribute accessor`;
        const count = accessors[accessorIndex].count;
        if (attributeCount === undefined) attributeCount = count;
        else if (attributeCount !== count) return `mesh ${meshIndex} primitive ${primitiveIndex} has mismatched attribute counts`;
      }
      if (primitive.indices !== undefined) {
        const accessor = accessors[primitive.indices];
        if (!Number.isInteger(primitive.indices) || !accessor) return `mesh ${meshIndex} primitive ${primitiveIndex} references an invalid index accessor`;
        if (accessor.type !== 'SCALAR' || ![5121, 5123, 5125].includes(accessor.componentType)) {
          return `mesh ${meshIndex} primitive ${primitiveIndex} has invalid index accessor`;
        }
      }
    }
  }
  return undefined;
}

function validateGlb(bytes) {
  if (bytes.length < 20 || bytes.subarray(0, 4).toString() !== 'glTF') return 'invalid GLB header';
  if (bytes.readUInt32LE(4) !== 2) return 'invalid GLB version';
  const declaredLength = bytes.readUInt32LE(8);
  if (declaredLength !== bytes.length) return 'invalid GLB declared length';

  let offset = 12;
  let chunkCount = 0;
  let gltf;
  let binLength = 0;
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
        gltf = JSON.parse(bytes.subarray(offset + 8, chunkEnd).toString('utf8').replace(/[\0\s]+$/u, ''));
      } catch {
        return 'invalid GLB JSON chunk';
      }
    } else {
      if (binLength) return 'multiple GLB BIN chunks';
      binLength = length;
    }
    offset = chunkEnd;
    chunkCount += 1;
  }
  if (chunkCount === 0 || !gltf) return 'missing GLB JSON chunk';
  return validateGltfSemantics(gltf, binLength);
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

async function launchWebpDecoder() {
  try {
    return await chromium.launch({ headless: true });
  } catch (primaryError) {
    const fallbackPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ?? (process.platform === 'darwin' && existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : undefined);
    if (!fallbackPath) throw primaryError;
    return chromium.launch({ headless: true, executablePath: fallbackPath });
  }
}

async function decodeWebpsInBrowser(files) {
  if (files.length === 0) return [];
  let browser;
  try {
    browser = await launchWebpDecoder();
    const page = await browser.newPage();
    return await page.evaluate(async (images) => Promise.all(images.map(({ runtimeFile, data }) => new Promise((resolveImage) => {
      const image = new Image();
      const finish = (result) => {
        clearTimeout(timeout);
        resolveImage(result);
      };
      const timeout = setTimeout(() => finish({ runtimeFile, error: 'WebP browser decoder rejected file' }), 1_500);
      image.onload = async () => {
        try {
          await image.decode();
          finish({ runtimeFile, width: image.naturalWidth, height: image.naturalHeight });
        } catch {
          finish({ runtimeFile, error: 'WebP browser decoder rejected file' });
        }
      };
      image.onerror = () => finish({ runtimeFile, error: 'WebP browser decoder rejected file' });
      image.src = `data:image/webp;base64,${data}`;
    }))), files);
  } finally {
    await browser?.close();
  }
}

if (!existsSync(manifestPath)) {
  console.error('Asset manifest not found: src/assets/credits.json');
  process.exit(1);
}

const problems = [];
const webpFiles = [];
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
          if (parsed.error) problems.push(`${label}: ${parsed.error}`);
          else {
            if (asset.runtimeFile.includes('/textures/teams/') && (parsed.width !== 512 || parsed.height !== 512)) {
              problems.push(`${label}: livery dimensions must be 512x512; found ${parsed.width}x${parsed.height}`);
            }
            webpFiles.push({ label, runtimeFile: asset.runtimeFile, data: bytes.toString('base64') });
          }
        }
      }
    }
  }

  for (const runtimeFile of requiredRuntimeFiles) {
    if (!runtimeFiles.has(runtimeFile)) problems.push(`missing required runtime file: ${runtimeFile}`);
  }
}

if (problems.length === 0) {
  try {
    const decodedWebps = await decodeWebpsInBrowser(webpFiles);
    const labels = new Map(webpFiles.map(({ label, runtimeFile }) => [runtimeFile, label]));
    for (const decoded of decodedWebps) {
      const label = labels.get(decoded.runtimeFile) ?? decoded.runtimeFile;
      if (decoded.error) problems.push(`${label}: ${decoded.error}`);
      else if (decoded.width !== 512 || decoded.height !== 512) {
        problems.push(`${label}: browser-decoded livery dimensions must be 512x512; found ${decoded.width}x${decoded.height}`);
      }
    }
  } catch (error) {
    problems.push(`Unable to launch WebP browser decoder: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}

console.log(`Asset manifest verified: ${manifest.length} entries`);
