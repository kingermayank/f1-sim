import { useEffect, useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { projectedTrack } from './game-store';
import { computeRacingGuide, guideColor } from './racing-line';

/** Half the drawn width of the line, metres. */
const HALF_WIDTH = 0.45;
/** Lifted off the tarmac so it never fights the road for depth. */
const LIFT = 0.07;
/** Dash pattern in samples: with 2560 samples a sample is about 2.1 m. */
const DASH_ON = 3;
const DASH_OFF = 1;

/**
 * The driving guide drawn on the road: a dashed ribbon along the racing line
 * whose colour runs green → yellow → red with how hard the car must slow
 * there. Built once as a single vertex-coloured mesh.
 */
function buildGuideGeometry(): BufferGeometry {
  const guide = computeRacingGuide(projectedTrack);
  const samples = guide.length;
  const positions: number[] = [];
  const colors: number[] = [];

  const corner = (index: number, side: number) => {
    const { point, tangent } = projectedTrack.at(guide[index % samples].fraction);
    return [point.x - tangent.z * side, point.y + LIFT, point.z + tangent.x * side];
  };

  for (let index = 0; index < samples; index += 1) {
    if (index % (DASH_ON + DASH_OFF) >= DASH_ON) continue;
    const next = index + 1;
    const a = corner(index, HALF_WIDTH);
    const b = corner(index, -HALF_WIDTH);
    const c = corner(next, HALF_WIDTH);
    const d = corner(next, -HALF_WIDTH);
    const ca = guideColor(guide[index].effort);
    const cb = guideColor(guide[next % samples].effort);
    // Two triangles per quad; colour interpolates along the dash.
    positions.push(...a, ...c, ...b, ...b, ...c, ...d);
    colors.push(...ca, ...cb, ...ca, ...ca, ...cb, ...cb);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export function GuideLine() {
  const geometry = useMemo(buildGuideGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} renderOrder={3} frustumCulled={false}>
      <meshBasicMaterial vertexColors transparent opacity={0.9} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
