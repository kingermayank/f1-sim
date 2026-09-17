import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Box3,
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
import { raceStore, useRaceStore } from '../store/race-store';
import { SHANGHAI_TRACK } from '../track/shanghai-track';
import { createSplineTrack } from '../track/spline-track';
import type { SceneQualityTier } from './RaceScene';
import { cloneSceneWithOwnedMaterials } from './scene-resources';

const TRACK = createSplineTrack(SHANGHAI_TRACK);
const RETIREMENT_PRESENTATION_TICKS = 80;
/** Rolling radius used to convert travelled distance into wheel rotation. */
const WHEEL_RADIUS_METRES = 0.36;
/**
 * Minimum on-screen separation between cars, as a fraction of a lap — roughly
 * 105 m at Shanghai, roughly twenty car lengths.
 *
 * This is deliberately a PRESENTATION rule, not a simulation one. Two closely
 * matched drivers can legitimately run a hundredth of a second apart, which is
 * about a metre and renders as one car inside another. Holding them apart in
 * the engine instead would rob the trailing car of real distance and change who
 * finishes where, so the race stays authoritative and only the drawing is
 * adjusted.
 */
const MINIMUM_VISUAL_GAP_LAPS = 0.02;

let spacingTick = -1;
const spacingByDriver = new Map<string, number>();

/**
 * Rendered lap progress for a car, held at least one visual gap behind the car
 * in front of it.
 *
 * The pass cascades: each car is spaced against the car ahead's ALREADY spaced
 * position, so a train of three cannot collapse back together. It is computed
 * once per simulation tick and shared, so every car sees the same answer
 * without any cross-component coordination.
 */
function renderedProgress(driverId: string): number | undefined {
  const snapshot = raceStore.getState().snapshot;
  if (snapshot.tick !== spacingTick) {
    spacingTick = snapshot.tick;
    spacingByDriver.clear();

    const running = snapshot.cars
      .filter((car) => car.status === 'running' && car.pitState === 'track')
      .sort((a, b) => (b.lap + b.distance) - (a.lap + a.distance));

    let previous = Number.POSITIVE_INFINITY;
    for (const car of running) {
      const actual = car.lap + car.distance;
      const held = Math.min(actual, previous - MINIMUM_VISUAL_GAP_LAPS);
      spacingByDriver.set(car.driverId, held);
      previous = held;
    }
  }
  return spacingByDriver.get(driverId);
}
const TAU = Math.PI * 2;
/** Real 2026-era F1 car length; Shanghai is authored in metres. */
const CAR_LENGTH_METRES = 5.6;
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
  // Sampled once for the initial placement only. Per-frame motion is driven
  // imperatively below so that moving a car never re-renders React.
  const initial = useMemo(() => {
    const sample = getCarTrackSample(car);
    return TRACK.sample(sample.distance, sample.lateral, sample.line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const wheelAngle = useRef(0);
  const lastPosition = useRef(new Vector3());
  const wheelMeshes = useRef<Mesh[] | null>(null);
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
    const object = group.current;
    if (!object) return;

    // Read the live car straight from the store. Subscribing to it would
    // re-render fourteen components every frame, which was the source of the
    // stutter: the smoothing below then chased a target that was already late.
    const live = raceStore.getState().snapshot.cars.find(
      (candidate) => candidate.driverId === driver.id,
    );
    if (!live) return;

    const sample = getCarTrackSample(live);

    // Hold cars visually apart so they never draw on top of each other.
    const spaced = renderedProgress(live.driverId);
    if (spaced !== undefined && sample.line !== 'pit') {
      sample.distance = ((spaced % 1) + 1) % 1;
    }

    const transform = TRACK.sample(sample.distance, sample.lateral, sample.line);
    const ahead = TRACK.sample(
      sample.line === 'pit' ? Math.min(1, sample.distance + 0.002) : (sample.distance + 0.002) % 1,
      sample.lateral,
      sample.line,
    );

    // Clamp delta so a dropped frame cannot teleport the car.
    const step = Math.min(delta, 0.05);
    const interpolation = 1 - Math.exp(-step * 13);
    lastPosition.current.copy(object.position);
    object.position.lerp(transform.position, interpolation);
    object.quaternion.slerp(transform.rotation, interpolation);

    if (wheelMeshes.current === null) {
      const found: Mesh[] = [];
      object.traverse((child) => {
        if (child instanceof Mesh && child.name.startsWith('wheel-')) found.push(child);
      });
      wheelMeshes.current = found;
    }

    if (wheelMeshes.current.length > 0) {
      // Spin the wheels from the distance actually covered on screen, wrapped to
      // one turn. The previous version accumulated total race distance into a
      // number in the hundreds of thousands of radians, which lost angular
      // precision and strobed.
      const travelled = object.position.distanceTo(lastPosition.current);
      wheelAngle.current = (wheelAngle.current + travelled / WHEEL_RADIUS_METRES) % TAU;
      const steering = Math.atan2(
        transform.tangent.clone().cross(ahead.tangent).y,
        transform.tangent.dot(ahead.tangent),
      );
      for (const wheel of wheelMeshes.current) {
        wheel.rotation.y = wheelAngle.current;
        if (wheel.name.includes('front')) wheel.rotation.z = steering * 2;
      }
    }
  });

  return (
    <group
      ref={group}
      name={`car-${driver.id}`}
      userData={{ driverId: driver.id, teamId: driver.teamId }}
      position={initial.position}
      quaternion={initial.rotation}
      onClick={(event) => {
        event.stopPropagation();
        selectDriver(driver.id);
      }}
    >
      {selected && (
        <mesh position={[0, 1.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.25, 1.48, 32]} />
          <meshBasicMaterial color="#e8f2ff" transparent opacity={0.75} depthWrite={false} />
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
        <group scale={CAR_LENGTH_METRES / 4.15}>
          <mesh castShadow position={[0, 0.47, 0.05]}>
            <boxGeometry args={[1.12, 0.4, 2.55]} />
            <meshStandardMaterial color={team.color} roughness={0.35} metalness={0.25} envMapIntensity={1.15} />
          </mesh>
          <mesh castShadow position={[0, 0.42, -1.55]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.46, 2.2, 8]} />
            <meshStandardMaterial color={team.accent} roughness={0.38} envMapIntensity={1.15} />
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
            <mesh
              key={index}
              name={`wheel-${z < 0 ? 'front' : 'rear'}-${index}`}
              position={[x, 0.4, z]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <cylinderGeometry args={[0.47, 0.47, 0.34, 16]} />
              <meshStandardMaterial color="#080a0b" roughness={0.92} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

/**
 * Loads the supplied model for a team. `useGLTF` caches by URL, so each team's
 * geometry is fetched and parsed once and then cloned for that team's two
 * drivers rather than loaded per car.
 */
function LoadedTeamCar({ car, selected, selectDriver, showLabel }: CarProps) {
  const driver = DRIVERS_2026.find((candidate) => candidate.id === car.driverId) ?? DRIVERS_2026[0];
  const team = TEAMS_2026.find((candidate) => candidate.id === driver.teamId) ?? TEAMS_2026[0];
  const gltf = useGLTF(ASSETS.teamCar(team.id));

  const cloneResources = useMemo(() => cloneSceneWithOwnedMaterials(gltf.scene, (ownedMaterial) => {
    if (!(ownedMaterial instanceof MeshStandardMaterial)) return;
    // The supplied models carry their own liveries, carbon, tyre, glass and
    // metal materials. Keep them and only tame the extremes so every car sits
    // in the same lighting rather than repainting them with flat team colours.
    const material = ownedMaterial;
    material.roughness = Math.min(0.92, Math.max(0.18, material.roughness));
    material.envMapIntensity = 1.12;
    if (material.color.r + material.color.g + material.color.b > 0.5) {
      material.color.multiplyScalar(1.12);
    }
  }), [gltf.scene]);

  useEffect(() => () => cloneResources.dispose(), [cloneResources]);
  useEffect(() => {
    cloneResources.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
  }, [cloneResources]);

  // The supplied cars are authored at wildly different scales (metres, x100 and
  // x0.03 across the seven archives), so normalise from each model's own bounds
  // instead of carrying per-team fudge factors.
  const normalized = useMemo(() => {
    const scene = cloneResources.scene;
    scene.scale.set(1, 1, 1);
    scene.position.set(0, 0, 0);
    const bounds = new Box3().setFromObject(scene);
    const size = bounds.getSize(new Vector3());
    const length = Math.max(size.x, size.z);
    if (!Number.isFinite(length) || length <= 0) return scene;
    const scale = CAR_LENGTH_METRES / length;
    scene.scale.setScalar(scale);
    // Re-measure after scaling so the car is centred laterally and its wheels
    // sit on the road surface.
    const scaled = new Box3().setFromObject(scene);
    const centre = scaled.getCenter(new Vector3());
    scene.position.set(-centre.x, -scaled.min.y, -centre.z);
    return scene;
  }, [cloneResources]);

  return <AnimatedCar car={car} selected={selected} selectDriver={selectDriver} model={normalized} showLabel={showLabel} />;
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
  // Subscribe to WHICH cars are on track, not to their moving state. This
  // returns a plain string, so the component only re-renders when a car joins
  // or leaves the field — not sixty times a second while they drive.
  const visibleKey = useRaceStore((state) => state.snapshot.cars
    .filter((car) => shouldPresentCar(car, state.snapshot.tick))
    .map((car) => car.driverId)
    .join(','));
  const selectedDriverId = useRaceStore((state) => state.selectedDriverId);
  const selectDriver = useRaceStore((state) => state.selectDriver);
  const labelsEnabled = useRaceStore((state) => state.labelsEnabled);

  const visibleCars = useMemo(() => {
    const ids = new Set(visibleKey ? visibleKey.split(',') : []);
    return raceStore.getState().snapshot.cars.filter((car) => ids.has(car.driverId));
  }, [visibleKey]);

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
