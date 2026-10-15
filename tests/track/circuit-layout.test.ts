import { describe, expect, it } from 'vitest';
import { CIRCUIT_LAYOUT, kerbAt, runoffAt, wallAt } from '../../src/track/circuit-layout';
import { createProjectedTrack } from '../../src/game/track-projection';
import { SHANGHAI_TRACK } from '../../src/track/shanghai-track';

const track = createProjectedTrack(SHANGHAI_TRACK);
const ROWS = CIRCUIT_LAYOUT.rows;

describe('APEX circuit layout', () => {
  it('covers the lap the cars drive, row for row', () => {
    expect(ROWS * CIRCUIT_LAYOUT.step).toBeCloseTo(track.lengthMeters, -1);
    for (const side of ['left', 'right'] as const) {
      expect(CIRCUIT_LAYOUT.wall[side]).toHaveLength(ROWS);
      expect(CIRCUIT_LAYOUT.kerb[side]).toHaveLength(ROWS);
      expect(CIRCUIT_LAYOUT.runoff[side]).toHaveLength(ROWS);
      expect(CIRCUIT_LAYOUT.runoff[side]).toMatch(/^[garpo]+$/);
    }
  });

  it('keeps every barrier clear of the kerbs and never steps along the lap', () => {
    for (const side of [1, -1]) {
      for (let row = 0; row < ROWS; row += 1) {
        const here = wallAt(row / ROWS, side);
        const next = wallAt((row + 1) / ROWS, side);
        expect(here).toBeGreaterThanOrEqual(track.kerbHalfWidth + 1);
        // A car sliding along a barrier must never meet a step in it.
        expect(Math.abs(next - here)).toBeLessThan(1.6);
      }
    }
  });

  it('interpolates the barrier between rows and wraps round the lap', () => {
    const a = wallAt(10 / ROWS, 1);
    const b = wallAt(11 / ROWS, 1);
    expect(wallAt(10.5 / ROWS, 1)).toBeCloseTo((a + b) / 2, 5);
    expect(wallAt(1 + 10 / ROWS, 1)).toBeCloseTo(a, 5);
    expect(wallAt(-1 + 10 / ROWS, 1)).toBeCloseTo(a, 5);
  });

  it('opens the pit wall only where the pit lane meets the track, on the pit side', () => {
    const pitSide = CIRCUIT_LAYOUT.pitSide;
    const other = pitSide > 0 ? 'right' : 'left';
    expect(CIRCUIT_LAYOUT.runoff[other]).not.toMatch(/[po]/);
    const openings = [...CIRCUIT_LAYOUT.runoff[pitSide > 0 ? 'left' : 'right']].filter((code) => code === 'o').length;
    // An entry and an exit, each a few dozen metres long.
    expect(openings * CIRCUIT_LAYOUT.step).toBeGreaterThan(40);
    expect(openings * CIRCUIT_LAYOUT.step).toBeLessThan(200);
    // The start line runs past the pit wall.
    expect(runoffAt(0, pitSide)).toBe('p');
  });

  it('kerbs the corners: both sides have kilometres of them, and the straights stay clear', () => {
    for (const side of [1, -1]) {
      let kerbed = 0;
      for (let row = 0; row < ROWS; row += 1) if (kerbAt(row / ROWS, side)) kerbed += 1;
      expect(kerbed * CIRCUIT_LAYOUT.step).toBeGreaterThan(1500);
      expect(kerbed).toBeLessThan(ROWS * 0.7);
    }
    // The start/finish straight has no kerbs.
    expect(kerbAt(0, 1)).toBe(false);
    expect(kerbAt(0, -1)).toBe(false);
  });
});
