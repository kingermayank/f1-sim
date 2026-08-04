import { CatmullRomCurve3, Quaternion, Vector3 } from 'three';
import type { SplineTrack, TrackDefinition, TrackPoint, TrackTransform } from './track-types';

type RacingLine = 'center' | 'attack' | 'defend' | 'pit';

const WORLD_UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);

function toVectors(points: TrackPoint[]): Vector3[] {
  return points.map(({ x, y, z }) => new Vector3(x, y, z));
}

function wrap(distance: number): number {
  return ((distance % 1) + 1) % 1;
}

function sampleCurve(curve: CatmullRomCurve3, distance: number, isClosed: boolean): TrackTransform {
  const parameter = isClosed ? wrap(distance) : Math.min(Math.max(distance, 0), 1);
  const position = curve.getPointAt(parameter);
  const tangent = curve.getTangentAt(parameter).normalize();
  const rotation = new Quaternion().setFromUnitVectors(FORWARD, tangent);

  return { position, rotation, tangent };
}

export function createSplineTrack(definition: TrackDefinition): SplineTrack {
  const curves: Record<RacingLine, CatmullRomCurve3> = {
    center: new CatmullRomCurve3(toVectors(definition.centerLine), true, 'catmullrom', 0.5),
    attack: new CatmullRomCurve3(toVectors(definition.attackLine), true, 'catmullrom', 0.5),
    defend: new CatmullRomCurve3(toVectors(definition.defendLine), true, 'catmullrom', 0.5),
    pit: new CatmullRomCurve3(toVectors(definition.pitLine), false, 'catmullrom', 0.5),
  };

  return {
    sample(distance, lateral, line = 'center') {
      const transform = sampleCurve(curves[line], distance, line !== 'pit');
      const lateralNormal = transform.tangent.clone().cross(WORLD_UP);

      if (lateralNormal.lengthSq() < Number.EPSILON) {
        lateralNormal.crossVectors(transform.tangent, FORWARD);
      }

      transform.position.addScaledVector(lateralNormal.normalize(), lateral);
      return transform;
    },
  };
}
