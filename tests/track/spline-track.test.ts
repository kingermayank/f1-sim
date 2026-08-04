import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createSplineTrack } from '../../src/track/spline-track';
import { MONACO_TRACK } from '../../src/track/monaco-track';

describe('SplineTrack', () => {
  it('closes the racing line continuously', () => {
    const track = createSplineTrack(MONACO_TRACK);
    const start = track.sample(0, 0);
    const end = track.sample(1, 0);

    expect(start.position.distanceTo(end.position)).toBeLessThan(0.01);
    expect(start.tangent.angleTo(end.tangent)).toBeLessThan(0.01);
  });

  it('wraps normalized center-line distances in either direction', () => {
    const track = createSplineTrack(MONACO_TRACK);
    const reference = track.sample(0.23, 0);

    expect(track.sample(1.23, 0).position.distanceTo(reference.position)).toBeLessThan(0.0001);
    expect(track.sample(-0.77, 0).position.distanceTo(reference.position)).toBeLessThan(0.0001);
  });

  it('keeps pit-line samples at their open-line boundaries', () => {
    const track = createSplineTrack(MONACO_TRACK);
    const entry = track.sample(0, 0, 'pit');
    const exit = track.sample(1, 0, 'pit');

    expect(entry.position.distanceTo(exit.position)).toBeGreaterThan(1);
    expect(track.sample(-0.2, 0, 'pit').position.distanceTo(entry.position)).toBeLessThan(0.0001);
    expect(track.sample(1.2, 0, 'pit').position.distanceTo(exit.position)).toBeLessThan(0.0001);
  });

  it('uses a stable orientation and lateral normal', () => {
    const track = createSplineTrack(MONACO_TRACK);
    const base = track.sample(0.4, 0);
    const left = track.sample(0.4, 3);
    const right = track.sample(0.4, -3);
    const expectedLateral = base.tangent.clone().cross(new Vector3(0, 1, 0)).normalize();

    expect(left.position.clone().sub(base.position).dot(expectedLateral)).toBeCloseTo(3, 4);
    expect(right.position.clone().sub(base.position).dot(expectedLateral)).toBeCloseTo(-3, 4);
    expect(base.rotation.length()).toBeCloseTo(1, 6);
    expect(base.rotation.angleTo(track.sample(1.4, 0).rotation)).toBeLessThan(0.0001);
  });

  it('provides grid slots, three sectors, pit path, wrapped zones, and camera anchors', () => {
    expect(MONACO_TRACK.gridSlots).toHaveLength(22);
    expect(MONACO_TRACK.sectors).toHaveLength(3);
    expect(MONACO_TRACK.pitLine.length).toBeGreaterThan(3);
    expect(MONACO_TRACK.cameraAnchors.length).toBeGreaterThanOrEqual(8);
    expect(MONACO_TRACK.zones).toContainEqual({ start: 0.91, end: 0.08, kind: 'speed-limit' });
  });
});
