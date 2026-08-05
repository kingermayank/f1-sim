import { useFrame } from '@react-three/fiber';
import { useGLTF, useTexture } from '@react-three/drei';
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from 'three';
import { ASSETS } from '../assets/asset-registry';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import type { CarState } from '../simulation/events';
import { useRaceStore } from '../store/race-store';
import { MONACO_TRACK } from '../track/monaco-track';
import { createSplineTrack } from '../track/spline-track';
import type { SceneQualityTier } from './RaceScene';
import { cloneSceneWithOwnedMaterials } from './scene-resources';

const TRACK = createSplineTrack(MONACO_TRACK);
const RETIREMENT_PRESENTATION_TICKS = 80;

type TrackLine = 'center' | 'attack' | 'defend' | 'pit';

export interface CarTrackSample {
  distance: number;
  lateral: number;
  line: TrackLine;
}

export function getCarTrackSample(car: CarState): CarTrackSample {
  if (car.targetLine === 'pit' || car.pitState !== 'track') {
    return { distance: car.pitProgress, lateral: 0, line: 'pit' };
  }

  return {
    distance: car.distance,
    lateral: car.lateralOffset,
    line: car.targetLine === 'racing' ? 'center' : car.targetLine,
  };
}

export function shouldPresentCar(car: CarState, currentTick: number): boolean {
  return car.status !== 'retired' || currentTick - car.retirementTick <= RETIREMENT_PRESENTATION_TICKS;
}

interface CarProps {
  car: CarState;
  selected: boolean;
  selectDriver(driverId: string): void;
  model?: Object3D;
}

function AnimatedCar({ car, selected, selectDriver, model }: CarProps) {
  const group = useRef<Group>(null);
  const driver = DRIVERS_2026.find((candidate) => candidate.id === car.driverId) ?? DRIVERS_2026[0];
  const team = TEAMS_2026.find((candidate) => candidate.id === driver.teamId) ?? TEAMS_2026[0];
  const sample = getCarTrackSample(car);
  const transform = TRACK.sample(sample.distance, sample.lateral, sample.line);
  const ahead = TRACK.sample(Math.min(0.999, sample.distance + 0.002), sample.lateral, sample.line);
  const wheelRotation = ((car.lap + car.distance) * MONACO_TRACK.lengthMeters) / 0.43;
  const steering = Math.atan2(
    transform.tangent.clone().cross(ahead.tangent).y,
    transform.tangent.dot(ahead.tangent),
  );

  useFrame((_, delta) => {
    if (!group.current) return;
    const interpolation = 1 - Math.exp(-delta * 13);
    group.current.position.lerp(transform.position, interpolation);
    group.current.quaternion.slerp(transform.rotation, interpolation);
    model?.traverse((object) => {
      if (!(object instanceof Mesh) || Math.abs(object.position.x) < 0.8 || Math.abs(object.position.z) < 0.8) return;
      object.rotation.y = wheelRotation;
      if (object.position.z < 0) object.rotation.z = steering * 2;
    });
  });

  return (
    <group
      ref={group}
      name={`car-${driver.id}`}
      userData={{ driverId: driver.id, teamId: driver.teamId }}
      position={transform.position}
      quaternion={transform.rotation}
      scale={0.72}
      onClick={(event) => {
        event.stopPropagation();
        selectDriver(driver.id);
      }}
    >
      {selected && (
        <mesh position={[0, 2.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.25, 1.48, 28]} />
          <meshBasicMaterial color="#fff3bd" transparent opacity={0.9} depthWrite={false} />
        </mesh>
      )}
      {model ? <primitive object={model} dispose={null} /> : (
        <group>
          <mesh castShadow position={[0, 0.48, 0]}>
            <boxGeometry args={[1.35, 0.36, 3.4]} />
            <meshStandardMaterial color={team.color} roughness={0.38} metalness={0.2} />
          </mesh>
          <mesh castShadow position={[0, 0.72, -0.28]}>
            <capsuleGeometry args={[0.38, 1.4, 4, 8]} />
            <meshStandardMaterial color={team.accent} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.38, -1.65]}>
            <boxGeometry args={[2.35, 0.12, 0.48]} />
            <meshStandardMaterial color="#111519" roughness={0.8} />
          </mesh>
          {[[-0.92, -1.02], [0.92, -1.02], [-0.92, 1.02], [0.92, 1.02]].map(([x, z], index) => (
            <mesh key={index} position={[x, 0.4, z]} rotation={[Math.PI / 2, wheelRotation, z < 0 ? steering * 2 : 0]}>
              <cylinderGeometry args={[0.43, 0.43, 0.28, 10]} />
              <meshStandardMaterial color="#080a0b" roughness={0.92} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

function LoadedTeamCar({ car, selected, selectDriver }: CarProps) {
  const driver = DRIVERS_2026.find((candidate) => candidate.id === car.driverId) ?? DRIVERS_2026[0];
  const team = TEAMS_2026.find((candidate) => candidate.id === driver.teamId) ?? TEAMS_2026[0];
  const gltf = useGLTF(ASSETS.car);
  const livery = useTexture(ASSETS.teamTexture(team.id));
  livery.colorSpace = SRGBColorSpace;

  const cloneResources = useMemo(() => cloneSceneWithOwnedMaterials(gltf.scene, (ownedMaterial) => {
      if (!(ownedMaterial instanceof MeshStandardMaterial)) return;
      const material = ownedMaterial;
      if (material.color.getHSL({ h: 0, s: 0, l: 0 }).l > 0.25) {
        material.color.set(team.color);
        material.map = livery;
      }
      material.roughness = 0.42;
      material.metalness = 0.12;
    }), [gltf.scene, livery, team.color]);

  useEffect(() => () => cloneResources.dispose(), [cloneResources]);
  useEffect(() => {
    cloneResources.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
  }, [cloneResources]);

  return <AnimatedCar car={car} selected={selected} selectDriver={selectDriver} model={cloneResources.scene} />;
}

class CarAssetBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function ProceduralCars({ cars, selectedDriverId, selectDriver }: {
  cars: readonly CarState[];
  selectedDriverId: string | null;
  selectDriver(driverId: string): void;
}) {
  return cars.map((car) => (
    <AnimatedCar
      key={car.driverId}
      car={car}
      selected={car.driverId === selectedDriverId}
      selectDriver={selectDriver}
    />
  ));
}

export function CarField({ quality }: { quality: SceneQualityTier }) {
  const cars = useRaceStore((state) => state.snapshot.cars);
  const tick = useRaceStore((state) => state.snapshot.tick);
  const selectedDriverId = useRaceStore((state) => state.selectedDriverId);
  const selectDriver = useRaceStore((state) => state.selectDriver);
  const visibleCars = cars.filter((car) => shouldPresentCar(car, tick));

  if (quality === 'mobile') {
    return <ProceduralCars cars={visibleCars} selectedDriverId={selectedDriverId} selectDriver={selectDriver} />;
  }

  return (
    <CarAssetBoundary fallback={
      <ProceduralCars cars={visibleCars} selectedDriverId={selectedDriverId} selectDriver={selectDriver} />
    }>
      <Suspense fallback={
        <ProceduralCars cars={visibleCars} selectedDriverId={selectedDriverId} selectDriver={selectDriver} />
      }>
        {visibleCars.map((car) => (
          <LoadedTeamCar
            key={car.driverId}
            car={car}
            selected={car.driverId === selectedDriverId}
            selectDriver={selectDriver}
          />
        ))}
      </Suspense>
    </CarAssetBoundary>
  );
}
