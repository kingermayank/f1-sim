import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, InstancedMesh, Object3D, Vector3 } from 'three';
import { useRaceStore } from '../store/race-store';
import { SHANGHAI_TRACK } from '../track/shanghai-track';
import { createSplineTrack } from '../track/spline-track';

export const EFFECT_POOL_CAPACITY = Object.freeze({ smoke: 32, sparks: 64, debris: 24 });

const TRACK = createSplineTrack(SHANGHAI_TRACK);
const dummy = new Object3D();
const hiddenScale = new Vector3(0, 0, 0);

function hideRemainder(mesh: InstancedMesh, start: number, total: number) {
  for (let index = start; index < total; index += 1) {
    dummy.position.set(0, -100, 0);
    dummy.scale.copy(hiddenScale);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
}

export function RaceEffects() {
  const smoke = useRef<InstancedMesh>(null);
  const sparks = useRef<InstancedMesh>(null);
  const debris = useRef<InstancedMesh>(null);
  const snapshot = useRaceStore((state) => state.snapshot);
  const eventFeed = useRaceStore((state) => state.eventFeed);
  const effectsEnabled = useRaceStore((state) => state.effectsEnabled);
  const reducedMotion = useRaceStore((state) => state.reducedMotion);
  const incident = useMemo(() => [...eventFeed].reverse().find((event) => event.type === 'incident'), [eventFeed]);

  useFrame(() => {
    if (!smoke.current || !sparks.current || !debris.current) return;
    const car = incident?.type === 'incident'
      ? snapshot.cars.find((candidate) => candidate.driverId === incident.driverIds[0])
      : undefined;
    const age = incident ? Math.max(0, (snapshot.tick - incident.tick) / 10) : Number.POSITIVE_INFINITY;
    const active = effectsEnabled && car && age < 4;
    const origin = active ? TRACK.sample(car.distance, car.lateralOffset).position : new Vector3(0, -100, 0);
    const smokeCount = active ? (reducedMotion ? 8 : EFFECT_POOL_CAPACITY.smoke) : 0;
    const sparkCount = active && !reducedMotion && age < 1.15 ? EFFECT_POOL_CAPACITY.sparks : 0;
    const debrisCount = active ? (reducedMotion ? 6 : EFFECT_POOL_CAPACITY.debris) : 0;

    for (let index = 0; index < smokeCount; index += 1) {
      const phase = (index / EFFECT_POOL_CAPACITY.smoke) * Math.PI * 2;
      const spread = 0.25 + (index % 7) * 0.13;
      dummy.position.set(
        origin.x + Math.cos(phase) * spread,
        origin.y + 0.5 + age * (0.45 + (index % 3) * 0.12),
        origin.z + Math.sin(phase) * spread,
      );
      const scale = Math.max(0, 0.22 + age * 0.28 - index * 0.002);
      dummy.scale.setScalar(scale);
      dummy.rotation.set(0, phase + age * 0.2, 0);
      dummy.updateMatrix();
      smoke.current.setMatrixAt(index, dummy.matrix);
    }
    hideRemainder(smoke.current, smokeCount, EFFECT_POOL_CAPACITY.smoke);

    for (let index = 0; index < sparkCount; index += 1) {
      const phase = index * 2.399;
      const travel = age * (2.2 + (index % 9) * 0.2);
      dummy.position.set(
        origin.x + Math.cos(phase) * travel,
        origin.y + 0.35 + Math.max(0, Math.sin(age * 4 + phase)) * 1.2,
        origin.z + Math.sin(phase) * travel,
      );
      dummy.scale.set(0.035, 0.035, 0.25);
      dummy.rotation.set(phase, phase * 0.5, phase);
      dummy.updateMatrix();
      sparks.current.setMatrixAt(index, dummy.matrix);
    }
    hideRemainder(sparks.current, sparkCount, EFFECT_POOL_CAPACITY.sparks);

    for (let index = 0; index < debrisCount; index += 1) {
      const phase = index * 1.618;
      const travel = Math.min(3.5, age * (0.8 + (index % 6) * 0.16));
      dummy.position.set(
        origin.x + Math.cos(phase) * travel,
        origin.y + 0.18 + Math.max(0, Math.sin(age * 2.6 + phase)) * 0.7,
        origin.z + Math.sin(phase) * travel,
      );
      dummy.scale.setScalar(0.08 + (index % 4) * 0.02);
      dummy.rotation.set(age * 2 + phase, phase, age * 3);
      dummy.updateMatrix();
      debris.current.setMatrixAt(index, dummy.matrix);
    }
    hideRemainder(debris.current, debrisCount, EFFECT_POOL_CAPACITY.debris);

    smoke.current.instanceMatrix.needsUpdate = true;
    sparks.current.instanceMatrix.needsUpdate = true;
    debris.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group name="pooled-race-effects">
      <instancedMesh ref={smoke} args={[undefined, undefined, EFFECT_POOL_CAPACITY.smoke]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color={new Color('#98a5b0')} transparent opacity={0.22} depthWrite={false} roughness={1} />
      </instancedMesh>
      <instancedMesh ref={sparks} args={[undefined, undefined, EFFECT_POOL_CAPACITY.sparks]} frustumCulled={false}>
        <tetrahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color="#e8ac45" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={debris} args={[undefined, undefined, EFFECT_POOL_CAPACITY.debris]} frustumCulled={false}>
        <boxGeometry args={[1, 0.35, 0.65]} />
        <meshStandardMaterial color="#14181a" roughness={0.88} />
      </instancedMesh>
    </group>
  );
}
