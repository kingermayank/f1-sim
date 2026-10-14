import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createProjectedTrack } from '../../src/game/track-projection';
import { buildGridMarks, buildTrackSurface, createSurfaceSampler, DEFAULT_SURFACE, rubberLine, surfaceRows } from '../../src/game/track-surface';
import { SHANGHAI_TRACK } from '../../src/track/shanghai-track';

const track = createProjectedTrack(SHANGHAI_TRACK);

describe('generated racing surface', () => {
  const surface = buildTrackSurface(track, null, () => 0, null);

  it('covers the whole lap at its row spacing', () => {
    const rows = surfaceRows(track);
    expect(surface.getAttribute('position').count).toBe(rows * DEFAULT_SURFACE.columns.length);
  });

  it('faces up everywhere', () => {
    const normals = surface.getAttribute('normal');
    for (let index = 0; index < normals.count; index += 53) expect(normals.getY(index)).toBeGreaterThan(0.5);
  });

  it('paints the track limits where the car is judged without kerb data', () => {
    const edge = surface.getAttribute('aEdge');
    expect(edge.getX(0)).toBeCloseTo(track.halfWidth, 5);
    expect(edge.getY(0)).toBeCloseTo(track.halfWidth, 5);
  });

  it('keeps the rubbered line on the road', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(Math.abs(rubberLine(track, index / 200))).toBeLessThanOrEqual(4.6);
    }
  });

  it('lies on the supplied tarmac when there is some underneath', () => {
    // A flat sheet of "tarmac" one metre above the centreline datum around the start.
    const { point } = track.at(0);
    const geometry = new BufferGeometry();
    const y = point.y + 0.5;
    geometry.setAttribute('position', new Float32BufferAttribute([
      point.x - 60, y, point.z - 60, point.x + 60, y, point.z - 60, point.x + 60, y, point.z + 60,
      point.x - 60, y, point.z - 60, point.x + 60, y, point.z + 60, point.x - 60, y, point.z + 60,
    ], 3));
    const material = new MeshStandardMaterial();
    material.name = 'tarmac';
    const root = new Group();
    root.add(new Mesh(geometry, material));
    const sampler = createSurfaceSampler(root, new Set(['tarmac']));
    expect(sampler.heightAt(point.x, point.z, point.y)).toBeCloseTo(y, 5);
    expect(sampler.heightAt(point.x + 500, point.z + 500, point.y)).toBeNull();
    const marks = buildGridMarks(track, [{ distance: 0.99, lateral: 3.2 }], sampler);
    expect(marks.getAttribute('position').count).toBeGreaterThan(0);
  });
});
