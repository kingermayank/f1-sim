import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ASSETS } from '../../src/assets/asset-registry';

function readGlbJson(path: string) {
  const bytes = readFileSync(path);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').replace(/[\0\s]+$/u, ''));
}

describe('asset registry', () => {
  it('exposes stable public paths for the shared race models and team liveries', () => {
    expect(ASSETS.track).toBe('/assets/models/monaco-track.glb');
    expect(ASSETS.car).toBe('/assets/models/f1-car.glb');
    expect(ASSETS.teamTexture('ferrari')).toBe('/assets/textures/teams/ferrari.webp');
  });

  it('ships a role-named open-wheel car with separated body, carbon, wheel, halo, and number mounts', () => {
    const gltf = readGlbJson('public/assets/models/f1-car.glb');
    const names = new Set((gltf.nodes ?? []).map((node: { name?: string }) => node.name));

    for (const required of [
      'body-shell', 'nose', 'floor', 'halo', 'front-wing', 'rear-wing',
      'wheel-front-left', 'wheel-front-right', 'wheel-rear-left', 'wheel-rear-right',
      'number-mount',
    ]) expect(names).toContain(required);
  });
});
