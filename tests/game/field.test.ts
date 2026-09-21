import { describe, expect, it } from 'vitest';
import type { CarState as AiCarState } from '../../src/simulation/events';
import {
  CAR_LENGTH_METRES,
  MIN_AI_GAP_METRES,
  avoidanceTarget,
  resolveCarContact,
  spaceField,
} from '../../src/game/field';

const LENGTH = 5340;

function car(driverId: string, progress: number, lateralOffset = 0, overrides: Partial<AiCarState> = {}): AiCarState {
  const lap = Math.floor(progress);
  return {
    driverId, lap, distance: progress - lap, lateralOffset, speed: 0.013,
    tire: { compound: 'medium', wear: 0, age: 0 }, fuelFactor: 1, damage: 0,
    pitState: 'track', pitProgress: 0, position: 1,
    timing: { lastLapSeconds: null, bestLapSeconds: null, lapStartTick: 0, sectorStartTick: 0, currentSector: 1, sectorTimes: [] },
    targetLine: 'racing', status: 'running',
    ...overrides,
  } as AiCarState;
}

function gapMetres(a: AiCarState, b: AiCarState): number {
  return ((a.lap + a.distance) - (b.lap + b.distance)) * LENGTH;
}

describe('spaceField', () => {
  it('holds cars in the same lane at least a gap apart, cascading down a train', () => {
    const field = [car('a', 2.5), car('b', 2.5 - 0.5 / LENGTH), car('c', 2.5 - 1 / LENGTH)];
    const spaced = spaceField(field, LENGTH);
    expect(gapMetres(spaced[0], spaced[1])).toBeCloseTo(MIN_AI_GAP_METRES, 6);
    expect(gapMetres(spaced[1], spaced[2])).toBeCloseTo(MIN_AI_GAP_METRES, 6);
    // Nobody is moved forward, and the leader is untouched.
    expect(spaced[0]).toBe(field[0]);
  });

  it('leaves side-by-side cars alone, so grid pairs survive', () => {
    const field = [car('a', 0.9978 - 1, -3.2), car('b', 0.9978 - 1, 3.2), car('c', 0.9963 - 1, -3.2)];
    const spaced = spaceField(field, LENGTH);
    expect(spaced[0]).toBe(field[0]);
    expect(spaced[1]).toBe(field[1]);
    // Row two is 8 m behind row one in the same lane, and gets held to 9 m.
    expect(gapMetres(spaced[0], spaced[2])).toBeCloseTo(MIN_AI_GAP_METRES, 6);
  });

  it('ignores cars in the pits or out of the race', () => {
    const field = [car('a', 2.5), car('b', 2.5, 0, { pitState: 'lane' }), car('c', 2.5, 0, { status: 'retired' })];
    const spaced = spaceField(field, LENGTH);
    expect(spaced[1]).toBe(field[1]);
    expect(spaced[2]).toBe(field[2]);
  });

  it('borrows a lap when holding a car back across the line', () => {
    const spaced = spaceField([car('a', 3.0005), car('b', 3.0004)], LENGTH);
    expect(spaced[1].lap).toBe(2);
    expect(spaced[1].distance).toBeGreaterThan(0.99);
  });
});

describe('avoidanceTarget', () => {
  const options = { rangeLaps: 40 / LENGTH, offsetMetres: 3.6, halfWidth: 6.8 };

  it('moves a nearby rival to the side of the track the player is not on', () => {
    expect(avoidanceTarget(2.5, 2.5, 1.0, options)).toBeCloseTo(-3.6);
    expect(avoidanceTarget(2.5, 2.5, -1.0, options)).toBeCloseTo(3.6);
  });

  it('is zero out of range and eases in at the edge', () => {
    expect(avoidanceTarget(2.5 + 60 / LENGTH, 2.5, 0, options)).toBe(0);
    const edge = Math.abs(avoidanceTarget(2.5 + 35 / LENGTH, 2.5, 0, options));
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(3.6);
  });
});

describe('resolveCarContact', () => {
  it('does nothing when no rival is close', () => {
    const result = resolveCarContact({ x: 0, z: 0, heading: 0, speed: 60 }, [{ x: 20, z: 0, heading: 0 }]);
    expect(result).toMatchObject({ x: 0, z: 0, speed: 60, contact: 0 });
  });

  it('pushes the player back out of a rival it has run into and takes speed', () => {
    const rival = { x: CAR_LENGTH_METRES * 0.7, z: 0, heading: 0 };
    const result = resolveCarContact({ x: 0, z: 0, heading: 0, speed: 60 }, [rival]);
    expect(result.contact).toBeGreaterThan(0);
    expect(result.x).toBeLessThan(0);
    expect(result.speed).toBeLessThan(60);
    // Fully separated after the resolve.
    expect(resolveCarContact({ ...result }, [rival]).contact).toBe(0);
  });

  it('a side touch costs less speed than a square hit and moves the player sideways', () => {
    const square = resolveCarContact({ x: 0, z: 0, heading: 0, speed: 60 }, [{ x: CAR_LENGTH_METRES * 0.7, z: 0, heading: 0 }]);
    const side = resolveCarContact({ x: 0, z: 0, heading: 0, speed: 60 }, [{ x: 0, z: 2.0, heading: 0 }]);
    expect(side.speed).toBeGreaterThan(square.speed);
    expect(side.z).toBeLessThan(0);
    expect(Math.abs(side.x)).toBeLessThan(0.01);
  });
});
