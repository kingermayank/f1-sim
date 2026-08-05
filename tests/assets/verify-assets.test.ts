import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'race-assets-'));
  temporaryRoots.push(root);
  const publicRoot = join(root, 'public');
  cpSync('public', publicRoot, { recursive: true });
  const manifestPath = join(root, 'credits.json');
  writeFileSync(manifestPath, readFileSync('src/assets/credits.json'));
  return { manifestPath, publicRoot };
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

    const glbPath = join(fixture.publicRoot, 'assets/models/monaco-track.glb');
    const glb = readFileSync(glbPath);
    glb.writeUInt32LE(1, 4);
    writeFileSync(glbPath, glb);
    const invalidGlb = verify(fixture.manifestPath, fixture.publicRoot);
    expect(invalidGlb.status).toBe(1);
    expect(invalidGlb.stderr).toMatch(/invalid GLB version/);

    cpSync('public', fixture.publicRoot, { recursive: true, force: true });
    const invalidAccessor = readFileSync(glbPath);
    const countOffset = invalidAccessor.indexOf(Buffer.from('"count":64'));
    expect(countOffset).toBeGreaterThan(-1);
    invalidAccessor.write('"count":99', countOffset, 'utf8');
    writeFileSync(glbPath, invalidAccessor);
    const invalidCount = verify(fixture.manifestPath, fixture.publicRoot);
    expect(invalidCount.status).toBe(1);
    expect(invalidCount.stderr).toMatch(/accessor \d+ exceeds bufferView byteLength/);

    cpSync('public', fixture.publicRoot, { recursive: true, force: true });
    const webpPath = join(fixture.publicRoot, 'assets/textures/teams/ferrari.webp');
    const webp = readFileSync(webpPath);
    webp.writeUInt32LE(1, 4);
    writeFileSync(webpPath, webp);
    const invalidWebp = verify(fixture.manifestPath, fixture.publicRoot);
    expect(invalidWebp.status).toBe(1);
    expect(invalidWebp.stderr).toMatch(/invalid WebP RIFF length/);

    cpSync('public', fixture.publicRoot, { recursive: true, force: true });
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
