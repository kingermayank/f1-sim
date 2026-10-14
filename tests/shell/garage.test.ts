import { describe, expect, it } from 'vitest';
import { SHANGHAI_TRACK } from '../../src/track/shanghai-track';
import { buildLapModel } from '../../src/shell/circuit-lap';
import { decodeGarage, encodeGarage } from '../../src/shell/garage-share';
import { parseHash, readHashParams } from '../../src/shell/router';

describe('garage links', () => {
  it('round-trips the car through the address', () => {
    const state = { driverId: 'hamilton', compound: 'hard', straight: true, angle: 'rear' } as const;
    const hash = encodeGarage(state);
    expect(parseHash(hash)).toEqual({ name: 'home' });
    expect(decodeGarage(readHashParams(hash))).toEqual(state);
  });

  it('ignores anything it does not recognise', () => {
    expect(decodeGarage(new URLSearchParams('d=nobody&t=wet&w=sideways&a=inside'))).toEqual({});
  });

  it('keeps routes with a query routing as before', () => {
    expect(parseHash('#/circuits/shanghai?x=1')).toEqual({ name: 'circuit', param: 'shanghai' });
  });
});

describe('circuit teaser lap model', () => {
  const lap = buildLapModel(SHANGHAI_TRACK);

  it('models a plausible Shanghai lap', () => {
    expect(lap.lapSeconds).toBeGreaterThan(80);
    expect(lap.lapSeconds).toBeLessThan(130);
    expect(lap.topSpeedKph).toBeGreaterThan(250);
  });

  it('ends the sectors in order, within the lap', () => {
    const [one, two, three] = lap.sectorEnds;
    expect(one).toBeGreaterThan(0.1);
    expect(two).toBeGreaterThan(one);
    expect(three).toBe(1);
  });

  it('keeps the running dot inside the button', () => {
    for (let index = 0; index < 50; index += 1) {
      const point = lap.at(index / 50);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(100);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(64);
    }
    expect(lap.path.startsWith('M')).toBe(true);
    expect(lap.path.endsWith('Z')).toBe(true);
  });

  it('starts the dot on the start line', () => {
    const start = lap.at(0);
    const tick = lap.startTick;
    expect((tick.x1 + tick.x2) / 2).toBeCloseTo(start.x, 0);
    expect((tick.y1 + tick.y2) / 2).toBeCloseTo(start.y, 0);
  });
});
