import { Box3, BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { carGeometry, CAR_DIMENSIONS } from '../../src/car/car-geometry';
import { FINISHES, LIVERIES, PATTERNS, liveryFor } from '../../src/car/liveries';
import { TEAMS_2026 } from '../../src/domain/grid-2026';

function bounds(geometry: BufferGeometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox!.clone();
}

describe('code-drawn car geometry', () => {
  for (const detail of ['high', 'low'] as const) {
    it(`builds a 2026-sized car at ${detail} detail`, () => {
      const car = carGeometry(detail);
      const body = new Box3();
      for (const part of [car.paint, car.carbon]) body.union(bounds(part));
      // Wheels sit outside the bodywork: include them at their centres.
      const r = CAR_DIMENSIONS.tyreRadius;
      for (const centre of car.wheelCentres) {
        body.expandByPoint(centre.clone().addScalar(r));
        body.expandByPoint(centre.clone().addScalar(-r));
      }
      const size = body.getSize(body.min.clone());
      expect(size.z).toBeGreaterThan(5.2);
      expect(size.z).toBeLessThan(5.7);
      expect(size.x).toBeGreaterThan(1.8);
      expect(size.x).toBeLessThan(2.4);
      // On the ground, roll hoop about a metre up.
      expect(body.min.y).toBeGreaterThanOrEqual(-0.01);
      expect(body.max.y).toBeGreaterThan(0.95);
      expect(body.max.y).toBeLessThan(1.2);
    });
  }

  it('gives every painted vertex a tone the paint shader reads', () => {
    const { paint } = carGeometry('high');
    const tone = paint.getAttribute('tone');
    expect(tone.count).toBe(paint.getAttribute('position').count);
    const values = new Set(Array.from(tone.array as Float32Array));
    // Livery, dark openings and the camera pod are all present.
    expect(values.has(0)).toBe(true);
    expect(values.has(1)).toBe(true);
    expect(values.has(2)).toBe(true);
  });

  it('keeps the low-detail car much lighter than the showroom car', () => {
    const high = carGeometry('high').paint.getIndex()!.count;
    const low = carGeometry('low').paint.getIndex()!.count;
    expect(low * 5).toBeLessThan(high);
  });

  it('builds once per detail level and shares the result', () => {
    expect(carGeometry('high')).toBe(carGeometry('high'));
  });

  it('puts the wheels at the 3.4 m wheelbase', () => {
    const [frontLeft, , rearLeft] = carGeometry('low').wheelCentres;
    expect(frontLeft.z - rearLeft.z).toBeCloseTo(3.4, 5);
  });
});

describe('liveries', () => {
  it('gives every team on the grid exactly one livery', () => {
    for (const team of TEAMS_2026) {
      expect(LIVERIES.filter((livery) => livery.teamId === team.id)).toHaveLength(1);
      expect(liveryFor(team.id).teamId).toBe(team.id);
    }
  });

  it('uses only known patterns, finishes and hex colours', () => {
    for (const livery of LIVERIES) {
      expect(PATTERNS).toHaveProperty(livery.pattern);
      expect(FINISHES).toHaveProperty(livery.finish);
      for (const colour of [livery.primary, livery.secondary, livery.accent, livery.numberInk, livery.helmet, livery.rim]) {
        expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
