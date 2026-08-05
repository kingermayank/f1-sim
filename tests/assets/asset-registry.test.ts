import { describe, expect, it } from 'vitest';
import { ASSETS } from '../../src/assets/asset-registry';

describe('asset registry', () => {
  it('exposes stable public paths for the shared race models and team liveries', () => {
    expect(ASSETS.track).toBe('/assets/models/monaco-track.glb');
    expect(ASSETS.car).toBe('/assets/models/f1-car.glb');
    expect(ASSETS.teamTexture('ferrari')).toBe('/assets/textures/teams/ferrari.webp');
  });
});
