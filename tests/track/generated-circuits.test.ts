import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { CALENDAR_2026 } from '../../src/content/calendar-2026';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import { createSplineTrack } from '../../src/track/spline-track';
import {
  loadCircuitRuntime,
  PLAYABLE_CIRCUIT_IDS,
  type PlayableCircuitId,
} from '../../src/track/circuit-registry';
import type { TrackPoint } from '../../src/track/track-types';
import type { TrackTransform } from '../../src/track/track-types';

const BATCH_A_IDS = ['suzuka', 'melbourne', 'barcelona', 'spa', 'silverstone'] as const;

function pointDistance(a: TrackPoint, b: TrackPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function expectFinitePoint(point: TrackPoint): void {
  expect(Number.isFinite(point.x)).toBe(true);
  expect(Number.isFinite(point.y)).toBe(true);
  expect(Number.isFinite(point.z)).toBe(true);
}

function expectFiniteTransform(transform: TrackTransform): void {
  for (const value of [
    ...transform.position.toArray(),
    ...transform.tangent.toArray(),
    ...transform.rotation.toArray(),
  ]) {
    expect(Number.isFinite(value)).toBe(true);
  }
  expect(transform.tangent.length()).toBeCloseTo(1, 5);
  expect(transform.rotation.length()).toBeCloseTo(1, 5);
}

describe.each(BATCH_A_IDS)('%s generated circuit', (id) => {
  it('is registered with a complete, source-aligned runtime definition', async () => {
    expect(PLAYABLE_CIRCUIT_IDS).toContain(id);

    const runtime = await loadCircuitRuntime(id as PlayableCircuitId);
    const track = runtime.track;
    const calendarId = id === 'barcelona' ? 'catalunya' : id;
    const round = CALENDAR_2026.find((candidate) => candidate.id === calendarId);

    expect(round).toBeDefined();
    expect(runtime.id).toBe(id);
    expect(runtime.laps).toBe(round!.laps);
    expect(runtime.assetUrl).toBe(`/assets/models/tracks/${id}.glb`);
    expect(track.id).toBe(id);

    const spline = createSplineTrack(track);
    for (const line of ['center', 'attack', 'defend', 'pit'] as const) {
      for (const distance of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
        expectFiniteTransform(spline.sample(distance, 0, line));
      }
    }

    for (const line of [track.centerLine, track.attackLine, track.defendLine]) {
      expect(line.length).toBeGreaterThan(16);
      expect(pointDistance(line[0]!, line.at(-1)!)).toBeLessThan(0.01);
      line.forEach(expectFinitePoint);
    }
    expect(track.pitLine.length).toBeGreaterThan(2);
    expect(pointDistance(track.pitLine[0]!, track.pitLine.at(-1)!)).toBeGreaterThan(1);
    track.pitLine.forEach(expectFinitePoint);

    expect(track.gridSlots.length).toBeGreaterThanOrEqual(DRIVERS_2026.length);
    expect(track.gridSlots.length).toBe(22);
    for (const slot of track.gridSlots) {
      expect(Number.isFinite(slot.distance)).toBe(true);
      expect(Number.isFinite(slot.lateral)).toBe(true);
      expect(slot.distance).toBeGreaterThanOrEqual(0);
      expect(slot.distance).toBeLessThanOrEqual(1);
    }

    expect(track.sectors).toHaveLength(3);
    expect(track.sectors[0]).toBeGreaterThan(0);
    expect(track.sectors[1]).toBeGreaterThan(track.sectors[0]);
    expect(track.sectors[2]).toBeGreaterThan(track.sectors[1]);
    expect(track.sectors[2]).toBe(1);

    expect(track.zones.some((zone) => zone.kind === 'passing')).toBe(true);
    expect(track.zones.some((zone) => zone.kind === 'yellow')).toBe(true);
    expect(track.zones.some((zone) => zone.kind === 'speed-limit')).toBe(true);
    for (const zone of track.zones) {
      expect(Number.isFinite(zone.start)).toBe(true);
      expect(Number.isFinite(zone.end)).toBe(true);
    }

    expect(track.cameraAnchors.length).toBeGreaterThanOrEqual(6);
    expect(new Set(track.cameraAnchors.map((anchor) => anchor.id)).size).toBe(track.cameraAnchors.length);
    expect(new Set(track.cameraAnchors.map((anchor) => anchor.name)).size).toBe(track.cameraAnchors.length);
    for (const anchor of track.cameraAnchors) {
      expect(Number.isFinite(anchor.distance)).toBe(true);
      expectFinitePoint(anchor.position);
      expectFinitePoint(anchor.targetOffset);
    }

    const officialLengthMeters = round!.lengthKm * 1_000;
    expect(Math.abs(track.lengthMeters - officialLengthMeters) / officialLengthMeters).toBeLessThanOrEqual(0.05);
    expect(existsSync(resolve(`src/track/generated/${id}-manifest.json`))).toBe(true);
    expect(existsSync(resolve(`public/assets/models/tracks/${id}.manifest.json`))).toBe(true);
    expect(existsSync(resolve(`public/assets/models/tracks/${id}.glb`))).toBe(true);
  });
});
