import { useFrame } from '@react-three/fiber';
import { Html, useGLTF, useTexture } from '@react-three/drei';
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  CanvasTexture,
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
const CLOSE_BATTLE_DISTANCE = 0.012;

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

export function shouldShowCarLabel(
  car: CarState,
  cars: readonly CarState[],
  selectedDriverId: string | null,
): boolean {
  if (car.driverId === selectedDriverId) return true;
  if (car.status !== 'running' || car.pitState !== 'track') return false;
  let closestGap = Number.POSITIVE_INFINITY;
  let firstId: string | null = null;
  let secondId: string | null = null;
  for (const first of cars) {
    if (first.status !== 'running' || first.pitState !== 'track') continue;
    for (const second of cars) {
      if (second.status !== 'running' || second.pitState !== 'track' || second.position !== first.position + 1) continue;
      const gap = Math.abs((first.lap + first.distance) - (second.lap + second.distance));
      if (gap <= CLOSE_BATTLE_DISTANCE && gap < closestGap) {
        closestGap = gap;
        firstId = first.driverId;
        secondId = second.driverId;
      }
    }
  }
  return car.driverId === firstId || car.driverId === secondId;
}

interface CarProps {
  car: CarState;
  selected: boolean;
  selectDriver(driverId: string): void;
  model?: Object3D;
  showLabel?: boolean;
}

function AnimatedCar({ car, selected, selectDriver, model, showLabel = false }: CarProps) {
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
  const wheelMeshes = useMemo(() => {
    const wheels: Mesh[] = [];
    model?.traverse((object) => {
      if (object instanceof Mesh && object.name.startsWith('wheel-')) wheels.push(object);
    });
    return wheels;
  }, [model]);
  const identifierTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#071018';
      context.fillRect(0, 0, 256, 128);
      context.fillStyle = team.color;
      context.fillRect(0, 0, 18, 128);
      context.fillStyle = '#f7f8fa';
      context.font = '900 76px Arial Narrow, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(String(driver.number), 137, 64);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }, [driver.number, team.color]);
  useEffect(() => () => identifierTexture.dispose(), [identifierTexture]);

  useFrame((_, delta) => {
    if (!group.current) return;
    const interpolation = 1 - Math.exp(-delta * 13);
    group.current.position.lerp(transform.position, interpolation);
    group.current.quaternion.slerp(transform.rotation, interpolation);
    wheelMeshes.forEach((wheel) => {
      wheel.rotation.y = wheelRotation;
      if (wheel.name.includes('front')) wheel.rotation.z = steering * 2;
    });
  });

  return (
    <group
      ref={group}
      name={`car-${driver.id}`}
      userData={{ driverId: driver.id, teamId: driver.teamId }}
      position={transform.position}
      quaternion={transform.rotation}
      scale={0.82}
      onClick={(event) => {
        event.stopPropagation();
        selectDriver(driver.id);
      }}
    >
      {selected && (
        <mesh position={[0, 1.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.25, 1.48, 28]} />
          <meshBasicMaterial color="#fff3bd" transparent opacity={0.9} depthWrite={false} />
        </mesh>
      )}
      {showLabel && (
        <Html center position={[0, 1.9, 0]} distanceFactor={13} className="car-label">
          <span style={{ '--driver-color': team.color } as React.CSSProperties}>{driver.abbreviation}</span>
        </Html>
      )}
      <mesh name={`driver-identifier-${driver.number}`} position={[0, 0.97, -0.48]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.7, 0.36]} />
        <meshBasicMaterial map={identifierTexture} toneMapped={false} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      {model ? <primitive object={model} dispose={null} /> : (
        <group>
          <mesh castShadow position={[0, 0.47, 0.05]}>
            <boxGeometry args={[1.12, 0.4, 2.55]} />
            <meshStandardMaterial color={team.color} roughness={0.38} metalness={0.2} />
          </mesh>
          <mesh castShadow position={[0, 0.42, -1.55]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.46, 2.2, 8]} />
            <meshStandardMaterial color={team.accent} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.18, 0]}>
            <boxGeometry args={[1.55, 0.08, 4.15]} />
            <meshStandardMaterial color="#0b1014" roughness={0.72} metalness={0.18} />
          </mesh>
          <mesh position={[0, 0.33, -2.12]}>
            <boxGeometry args={[2.25, 0.1, 0.42]} />
            <meshStandardMaterial color="#111519" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.9, 1.92]}><boxGeometry args={[1.82, 0.12, 0.3]} /><meshStandardMaterial color="#111519" roughness={0.8} /></mesh>
          <mesh position={[0, 0.76, 0.02]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.42, 0.055, 6, 14, Math.PI * 1.35]} /><meshStandardMaterial color="#111519" roughness={0.7} /></mesh>
          {[[-0.98, -1.35], [0.98, -1.35], [-0.98, 1.25], [0.98, 1.25]].map(([x, z], index) => (
            <mesh key={index} position={[x, 0.4, z]} rotation={[Math.PI / 2, wheelRotation, z < 0 ? steering * 2 : 0]}>
              <cylinderGeometry args={[0.47, 0.47, 0.34, 16]} />
              <meshStandardMaterial color="#080a0b" roughness={0.92} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

function LoadedTeamCar({ car, selected, selectDriver, showLabel }: CarProps) {
  const driver = DRIVERS_2026.find((candidate) => candidate.id === car.driverId) ?? DRIVERS_2026[0];
  const team = TEAMS_2026.find((candidate) => candidate.id === driver.teamId) ?? TEAMS_2026[0];
  const gltf = useGLTF(ASSETS.car);
  const livery = useTexture(ASSETS.teamTexture(team.id));
  livery.colorSpace = SRGBColorSpace;

  const cloneResources = useMemo(() => cloneSceneWithOwnedMaterials(gltf.scene, (ownedMaterial, mesh) => {
      if (!(ownedMaterial instanceof MeshStandardMaterial)) return;
      const material = ownedMaterial;
      const carbonPart = /wheel|wing|floor|halo|suspension|cockpit/.test(mesh.name);
      if (carbonPart) {
        material.color.set(mesh.name.startsWith('wheel') ? '#07090b' : '#111820');
        material.map = null;
        material.roughness = mesh.name.startsWith('wheel') ? 0.88 : 0.58;
        material.metalness = mesh.name.startsWith('wheel') ? 0.02 : 0.18;
      } else {
        material.color.set(mesh.name === 'nose' ? team.accent : mesh.name === 'number-mount' ? '#f4f6f7' : team.color);
        material.map = mesh.name.startsWith('sidepod') ? livery : null;
        material.emissive.set(team.color);
        material.emissiveIntensity = 0.045;
        material.roughness = 0.32;
        material.metalness = 0.16;
      }
    }), [gltf.scene, livery, team.color]);

  useEffect(() => () => cloneResources.dispose(), [cloneResources]);
  useEffect(() => {
    cloneResources.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
  }, [cloneResources]);

  return <AnimatedCar car={car} selected={selected} selectDriver={selectDriver} model={cloneResources.scene} showLabel={showLabel} />;
}

class CarAssetBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function ProceduralCars({ cars, selectedDriverId, selectDriver, labelsEnabled }: {
  cars: readonly CarState[];
  selectedDriverId: string | null;
  selectDriver(driverId: string): void;
  labelsEnabled: boolean;
}) {
  return cars.map((car) => (
    <AnimatedCar
      key={car.driverId}
      car={car}
      selected={car.driverId === selectedDriverId}
      selectDriver={selectDriver}
      showLabel={labelsEnabled && shouldShowCarLabel(car, cars, selectedDriverId)}
    />
  ));
}

export function CarField({ quality }: { quality: SceneQualityTier }) {
  const cars = useRaceStore((state) => state.snapshot.cars);
  const tick = useRaceStore((state) => state.snapshot.tick);
  const selectedDriverId = useRaceStore((state) => state.selectedDriverId);
  const selectDriver = useRaceStore((state) => state.selectDriver);
  const labelsEnabled = useRaceStore((state) => state.labelsEnabled);
  const visibleCars = cars.filter((car) => shouldPresentCar(car, tick));

  if (quality === 'mobile') {
    return <ProceduralCars cars={visibleCars} selectedDriverId={selectedDriverId} selectDriver={selectDriver} labelsEnabled={labelsEnabled} />;
  }

  return (
    <CarAssetBoundary fallback={
      <ProceduralCars cars={visibleCars} selectedDriverId={selectedDriverId} selectDriver={selectDriver} labelsEnabled={labelsEnabled} />
    }>
      <Suspense fallback={
        <ProceduralCars cars={visibleCars} selectedDriverId={selectedDriverId} selectDriver={selectDriver} labelsEnabled={labelsEnabled} />
      }>
        {visibleCars.map((car) => (
          <LoadedTeamCar
            key={car.driverId}
            car={car}
            selected={car.driverId === selectedDriverId}
            selectDriver={selectDriver}
            showLabel={labelsEnabled && shouldShowCarLabel(car, visibleCars, selectedDriverId)}
          />
        ))}
      </Suspense>
    </CarAssetBoundary>
  );
}
