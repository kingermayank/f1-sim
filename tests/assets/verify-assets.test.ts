import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];

function resetPublicFixture(publicRoot: string) {
  rmSync(publicRoot, { recursive: true, force: true });
  cpSync('public', publicRoot, { recursive: true });
  rmSync(join(publicRoot, 'assets/models/tracks'), { recursive: true, force: true });
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'race-assets-'));
  temporaryRoots.push(root);
  const publicRoot = join(root, 'public');
  resetPublicFixture(publicRoot);
  const manifestPath = join(root, 'credits.json');
  const credits = JSON.parse(readFileSync('src/assets/credits.json', 'utf8'))
    .filter((credit: { runtimeFile?: string }) => !credit.runtimeFile?.startsWith('/assets/models/tracks/'));
  writeFileSync(manifestPath, JSON.stringify(credits));
  return { manifestPath, publicRoot };
}

/** Reads the GLB's JSON chunk without needing a full glTF parser. */
function readGlbJson(glb: Buffer): { json: Record<string, any>; text: string; start: number } {
  const declaredLength = glb.readUInt32LE(8);
  let offset = 12;
  while (offset < declaredLength) {
    const length = glb.readUInt32LE(offset);
    const type = glb.subarray(offset + 4, offset + 8).toString();
    if (type === 'JSON') {
      const start = offset + 8;
      const text = glb.subarray(start, start + length).toString('utf8');
      return { json: JSON.parse(text.replace(/[\0\s]+$/u, '')), text, start };
    }
    offset += 8 + length;
  }
  throw new Error('GLB has no JSON chunk');
}

function rewriteGlbJson(glb: Buffer, mutate: (json: Record<string, any>) => void): Buffer {
  const { json } = readGlbJson(glb);
  mutate(json);
  const encoded = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.concat([encoded, Buffer.alloc((4 - (encoded.length % 4)) % 4, 0x20)]);
  let offset = 12;
  let bin = Buffer.alloc(0);
  while (offset < glb.length) {
    const length = glb.readUInt32LE(offset);
    const type = glb.subarray(offset + 4, offset + 8).toString();
    if (type === 'BIN\0') bin = Buffer.from(glb.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  const totalLength = 12 + 8 + paddedJson.length + (bin.length > 0 ? 8 + bin.length : 0);
  const rewritten = Buffer.alloc(totalLength);
  rewritten.write('glTF', 0);
  rewritten.writeUInt32LE(2, 4);
  rewritten.writeUInt32LE(totalLength, 8);
  rewritten.writeUInt32LE(paddedJson.length, 12);
  rewritten.write('JSON', 16);
  paddedJson.copy(rewritten, 20);
  if (bin.length > 0) {
    const binHeader = 20 + paddedJson.length;
    rewritten.writeUInt32LE(bin.length, binHeader);
    rewritten.write('BIN\0', binHeader + 4);
    bin.copy(rewritten, binHeader + 8);
  }
  return rewritten;
}

/**
 * Finds an accessor whose `byteOffset` can be inflated in place — same digit
 * count, larger value — so it reads past the end of its bufferView. Deriving
 * this from the file keeps the test valid as the runtime model changes.
 */
function findOverflowableAccessorOffset(glb: Buffer): { offset: number; replacement: string } | null {
  const { json, text, start } = readGlbJson(glb);
  for (const accessor of json.accessors ?? []) {
    const byteOffset: number = accessor.byteOffset ?? 0;
    const digits = String(byteOffset);
    if (byteOffset <= 0 || digits[0] === '9') continue;
    const view = json.bufferViews?.[accessor.bufferView];
    if (!view) continue;
    const inflated = `9${digits.slice(1)}`;
    if (Number(inflated) <= view.byteLength) continue;
    const needle = `"byteOffset":${digits},"bufferView":${accessor.bufferView}`;
    const index = text.indexOf(needle);
    if (index < 0) continue;
    return {
      offset: start + index,
      replacement: `"byteOffset":${inflated},"bufferView":${accessor.bufferView}`,
    };
  }
  return null;
}

function verify(manifestPath: string, publicRoot: string) {
  return spawnSync('node', ['scripts/verify-assets.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, ASSET_MANIFEST_PATH: manifestPath, ASSET_PUBLIC_ROOT: publicRoot },
  });
}

afterEach(() => {
  while (temporaryRoots.length) rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
});

describe('asset verifier binary validation', () => {
  it('rejects malformed and semantically unloadable GLB/WebP runtime files', () => {
    const fixture = createFixture();
    const valid = verify(fixture.manifestPath, fixture.publicRoot);
    expect(valid.status).toBe(0);

    const glbPath = join(fixture.publicRoot, 'assets/models/shanghai-track.glb');
    const glb = readFileSync(glbPath);
    glb.writeUInt32LE(1, 4);
    writeFileSync(glbPath, glb);
    const invalidGlb = verify(fixture.manifestPath, fixture.publicRoot);
    expect(invalidGlb.status).toBe(1);
    expect(invalidGlb.stderr).toMatch(/invalid GLB version/);

    resetPublicFixture(fixture.publicRoot);
    const invalidAccessor = readFileSync(glbPath);
    // Push an accessor past the end of its bufferView. The replacement is
    // derived from the file and is exactly as wide as the original, so the GLB
    // chunk lengths stay valid and only the accessor bounds become wrong.
    const accessorOffset = findOverflowableAccessorOffset(invalidAccessor);
    expect(accessorOffset).not.toBeNull();
    invalidAccessor.write(accessorOffset!.replacement, accessorOffset!.offset, 'utf8');
    writeFileSync(glbPath, invalidAccessor);
    const invalidCount = verify(fixture.manifestPath, fixture.publicRoot);
    expect(invalidCount.status).toBe(1);
    expect(invalidCount.stderr).toMatch(/accessor \d+ exceeds bufferView byteLength/);

    for (const [mutate, expected] of [
      [(json: Record<string, any>) => { delete json.asset.version; }, /missing asset\.version/],
      [(json: Record<string, any>) => { json.scenes = []; }, /usable scene/],
      [(json: Record<string, any>) => { json.meshes = []; }, /non-empty mesh primitive/],
    ] as const) {
      resetPublicFixture(fixture.publicRoot);
      const semanticallyEmpty = rewriteGlbJson(readFileSync(glbPath), mutate);
      writeFileSync(glbPath, semanticallyEmpty);
      const invalidSemantics = verify(fixture.manifestPath, fixture.publicRoot);
      expect(invalidSemantics.status).toBe(1);
      expect(invalidSemantics.stderr).toMatch(expected);
    }

    resetPublicFixture(fixture.publicRoot);
    const webpPath = join(fixture.publicRoot, 'assets/textures/teams/ferrari.webp');
    const webp = readFileSync(webpPath);
    webp.writeUInt32LE(1, 4);
    writeFileSync(webpPath, webp);
    const invalidWebp = verify(fixture.manifestPath, fixture.publicRoot);
    expect(invalidWebp.status).toBe(1);
    expect(invalidWebp.stderr).toMatch(/invalid WebP RIFF length/);

    resetPublicFixture(fixture.publicRoot);
    const corruptFrame = readFileSync(webpPath);
    const vp8ChunkOffset = corruptFrame.indexOf(Buffer.from('VP8 '));
    expect(vp8ChunkOffset).toBeGreaterThan(-1);
    const vp8DataStart = vp8ChunkOffset + 8;
    // Preserve VP8 framing, start code, and dimensions while truncating the frame payload.
    const truncatedFrame = Buffer.from(corruptFrame.subarray(0, vp8DataStart + 10));
    truncatedFrame.writeUInt32LE(10, vp8ChunkOffset + 4);
    truncatedFrame.writeUInt32LE(truncatedFrame.length - 8, 4);
    writeFileSync(webpPath, truncatedFrame);
    const invalidFrame = verify(fixture.manifestPath, fixture.publicRoot);
    expect(invalidFrame.status).toBe(1);
    expect(invalidFrame.stderr).toMatch(/WebP browser decoder rejected file/);
  }, 15_000);
});
