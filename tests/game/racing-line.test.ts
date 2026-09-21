import { describe, expect, it } from 'vitest';
import { CAR } from '../../src/game/car-physics';
import { projectedTrack } from '../../src/game/game-store';
import { computeRacingGuide, guideColor } from '../../src/game/racing-line';

describe('racing guide', () => {
  const guide = computeRacingGuide(projectedTrack, 1280);
  const at = (fraction: number) => guide[Math.round(fraction * guide.length) % guide.length];

  it('never asks for more than the car can do', () => {
    for (const sample of guide) {
      expect(Number.isFinite(sample.speed)).toBe(true);
      expect(sample.speed).toBeGreaterThan(5);
      expect(sample.speed).toBeLessThanOrEqual(CAR.topSpeed + 1e-9);
      expect(sample.effort).toBeGreaterThanOrEqual(0);
      expect(sample.effort).toBeLessThanOrEqual(1);
    }
  });

  it('is flat out on the back straight and braking into the hairpin', () => {
    // Back straight: 0.70-0.78 on this circuit. The hairpin apex is near 0.84.
    expect(at(0.74).speed).toBeGreaterThan(CAR.topSpeed * 0.95);
    expect(at(0.74).effort).toBeLessThan(0.2);
    const apex = guide.slice(Math.round(0.81 * guide.length), Math.round(0.86 * guide.length))
      .reduce((slowest, sample) => (sample.speed < slowest.speed ? sample : slowest));
    expect(apex.speed).toBeLessThan(45);
    // Somewhere in the 150 m before the apex the guide says brake.
    const before = guide.slice(Math.round((apex.fraction - 150 / projectedTrack.lengthMeters) * guide.length), Math.round(apex.fraction * guide.length));
    expect(Math.max(...before.map((sample) => sample.effort))).toBeGreaterThan(0.6);
  });

  it('respects the brakes: speed never drops faster than they allow', () => {
    const step = projectedTrack.lengthMeters / guide.length;
    for (let index = 0; index < guide.length; index += 1) {
      const v = guide[index].speed;
      const next = guide[(index + 1) % guide.length].speed;
      const decel = (v * v - next * next) / (2 * step);
      // The guide brakes at a human 60% of what the car can do.
      const maxDecel = (0.6 * (CAR.brakeForce + CAR.dragCoefficient * v * v + CAR.rollingResistance)) / CAR.mass;
      expect(decel).toBeLessThanOrEqual(maxDecel + 0.5);
    }
  });

  it('colours effort green to yellow to red', () => {
    expect(guideColor(0)[1]).toBeGreaterThan(guideColor(0)[0]);
    expect(guideColor(1)[0]).toBeGreaterThan(guideColor(1)[1]);
    const mid = guideColor(0.5);
    expect(mid[0]).toBeGreaterThan(0.9);
    expect(mid[1]).toBeGreaterThan(0.7);
  });
});
