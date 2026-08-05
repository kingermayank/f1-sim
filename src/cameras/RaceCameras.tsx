import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { PerspectiveCamera, Vector3 } from 'three';
import { raceStore, useRaceStore, type CameraMode, type RaceStoreState } from '../store/race-store';
import type { CarState } from '../simulation/events';
import { MONACO_TRACK } from '../track/monaco-track';
import { createSplineTrack } from '../track/spline-track';
import type { CameraAnchor, TrackPoint, TrackTransform } from '../track/track-types';
import { selectBroadcastShot, type BroadcastShot } from './camera-director';

type CameraTrackLine = 'center' | 'attack' | 'defend' | 'pit';
const TRACK_LINES: readonly CameraTrackLine[] = ['center', 'attack', 'defend', 'pit'];
const SAMPLE_STRIDE = 6;
const OVERHEAD_FOV = 42;
const OVERHEAD_MARGIN = 1.12;

export interface TrackBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface MutableCameraTrackSample {
  x: number;
  y: number;
  z: number;
  tangentX: number;
  tangentY: number;
  tangentZ: number;
}

export interface CameraTrackSampleCache {
  readonly resolution: number;
  readonly lines: Readonly<Record<CameraTrackLine, Float64Array>>;
}

interface TrackSampler {
  sample(distance: number, lateral: number, line?: CameraTrackLine): TrackTransform;
}

export interface CameraPose {
  position: Vector3;
  target: Vector3;
  fov: number;
}

export function calculateTrackBounds(points: readonly TrackPoint[]): TrackBounds {
  if (points.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

const TRACK_BOUNDS = calculateTrackBounds(MONACO_TRACK.centerLine);

function overheadClearance(bounds: TrackBounds, aspect: number, fov: number, margin: number): number {
  const verticalHalfAngle = (fov * Math.PI) / 360;
  const safeAspect = Math.max(0.1, aspect);
  const horizontalHalfAngle = Math.atan(Math.tan(verticalHalfAngle) * safeAspect);
  const verticalDistance = ((bounds.maxZ - bounds.minZ) / 2) / Math.tan(verticalHalfAngle);
  const horizontalDistance = ((bounds.maxX - bounds.minX) / 2) / Math.tan(horizontalHalfAngle);
  return Math.max(verticalDistance, horizontalDistance) * margin;
}

export function calculateOverheadCameraPose(
  bounds: TrackBounds,
  aspect: number,
  fov = OVERHEAD_FOV,
  margin = OVERHEAD_MARGIN,
): CameraPose {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  return {
    position: new Vector3(centerX, bounds.maxY + overheadClearance(bounds, aspect, fov, margin), centerZ + 0.001),
    target: new Vector3(centerX, centerY, centerZ),
    fov,
  };
}

export function createCameraTrackSampleCache(
  sampler: TrackSampler,
  resolution = 1024,
): CameraTrackSampleCache {
  const safeResolution = Math.max(2, Math.floor(resolution));
  const lines = {} as Record<CameraTrackLine, Float64Array>;
  for (const line of TRACK_LINES) {
    const values = new Float64Array((safeResolution + 1) * SAMPLE_STRIDE);
    for (let index = 0; index <= safeResolution; index += 1) {
      const transform = sampler.sample(index / safeResolution, 0, line);
      const offset = index * SAMPLE_STRIDE;
      values[offset] = transform.position.x;
      values[offset + 1] = transform.position.y;
      values[offset + 2] = transform.position.z;
      values[offset + 3] = transform.tangent.x;
      values[offset + 4] = transform.tangent.y;
      values[offset + 5] = transform.tangent.z;
    }
    lines[line] = values;
  }
  return { resolution: safeResolution, lines };
}

export function sampleCameraTrackInto(
  cache: CameraTrackSampleCache,
  distance: number,
  lateral: number,
  line: CameraTrackLine,
  output: MutableCameraTrackSample,
): MutableCameraTrackSample {
  const normalized = line === 'pit'
    ? Math.min(1, Math.max(0, distance))
    : ((distance % 1) + 1) % 1;
  const index = line === 'pit'
    ? Math.round(normalized * cache.resolution)
    : Math.round(normalized * cache.resolution) % cache.resolution;
  const offset = index * SAMPLE_STRIDE;
  const values = cache.lines[line];
  const tangentX = values[offset + 3];
  const tangentY = values[offset + 4];
  const tangentZ = values[offset + 5];
  let lateralX = -tangentZ;
  let lateralY = 0;
  let lateralZ = tangentX;
  let lateralLength = Math.hypot(lateralX, lateralZ);
  if (lateralLength < Number.EPSILON) {
    lateralX = tangentY;
    lateralY = -tangentX;
    lateralZ = 0;
    lateralLength = Math.hypot(lateralX, lateralY) || 1;
  }
  output.x = values[offset] + (lateralX / lateralLength) * lateral;
  output.y = values[offset + 1] + (lateralY / lateralLength) * lateral;
  output.z = values[offset + 2] + (lateralZ / lateralLength) * lateral;
  output.tangentX = tangentX;
  output.tangentY = tangentY;
  output.tangentZ = tangentZ;
  return output;
}

const TRACK_CACHE = createCameraTrackSampleCache(createSplineTrack(MONACO_TRACK));
const FREE_TARGET: [number, number, number] = [
  (TRACK_BOUNDS.minX + TRACK_BOUNDS.maxX) / 2,
  (TRACK_BOUNDS.minY + TRACK_BOUNDS.maxY) / 2,
  (TRACK_BOUNDS.minZ + TRACK_BOUNDS.maxZ) / 2,
];

function calculateCameraPoseInto(
  mode: CameraMode,
  sample: MutableCameraTrackSample,
  anchor: CameraAnchor,
  aspect: number,
  output: CameraPose,
): boolean {
  if (mode === 'free') return false;
  if (mode === 'overhead') {
    const centerX = (TRACK_BOUNDS.minX + TRACK_BOUNDS.maxX) / 2;
    const centerY = (TRACK_BOUNDS.minY + TRACK_BOUNDS.maxY) / 2;
    const centerZ = (TRACK_BOUNDS.minZ + TRACK_BOUNDS.maxZ) / 2;
    output.position.set(
      centerX,
      TRACK_BOUNDS.maxY + overheadClearance(TRACK_BOUNDS, aspect, OVERHEAD_FOV, OVERHEAD_MARGIN),
      centerZ + 0.001,
    );
    output.target.set(centerX, centerY, centerZ);
    output.fov = OVERHEAD_FOV;
    return true;
  }
  if (mode === 'broadcast') {
    output.position.set(anchor.position.x, anchor.position.y, anchor.position.z);
    output.target.set(
      sample.x + anchor.targetOffset.x,
      sample.y + anchor.targetOffset.y,
      sample.z + anchor.targetOffset.z,
    );
    output.fov = 38;
    return true;
  }
  if (mode === 'cockpit') {
    output.position.set(
      sample.x + sample.tangentX * 0.65,
      sample.y + sample.tangentY * 0.65 + 1.05,
      sample.z + sample.tangentZ * 0.65,
    );
    output.target.set(
      sample.x + sample.tangentX * 12,
      sample.y + sample.tangentY * 12 + 0.8,
      sample.z + sample.tangentZ * 12,
    );
    output.fov = 58;
    return true;
  }
  output.position.set(
    sample.x - sample.tangentX * 7,
    sample.y - sample.tangentY * 7 + 3.2,
    sample.z - sample.tangentZ * 7,
  );
  output.target.set(
    sample.x + sample.tangentX * 6,
    sample.y + sample.tangentY * 6 + 0.8,
    sample.z + sample.tangentZ * 6,
  );
  output.fov = 48;
  return true;
}

/** Allocating convenience wrapper for tests and one-off pose calculations, not the live camera loop. */
export function calculateCameraPose(
  mode: CameraMode,
  transform: TrackTransform,
  anchor: CameraAnchor,
  aspect = 16 / 9,
): CameraPose | null {
  if (mode === 'overhead') return calculateOverheadCameraPose(TRACK_BOUNDS, aspect);
  const output = { position: new Vector3(), target: new Vector3(), fov: 38 };
  const sample = {
    x: transform.position.x,
    y: transform.position.y,
    z: transform.position.z,
    tangentX: transform.tangent.x,
    tangentY: transform.tangent.y,
    tangentZ: transform.tangent.z,
  };
  return calculateCameraPoseInto(mode, sample, anchor, aspect, output) ? output : null;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

function trackedCar(cars: readonly CarState[], preferredId: string | null): CarState | undefined {
  let leader: CarState | undefined;
  for (const car of cars) {
    if (car.driverId === preferredId) return car;
    if (!leader || car.position < leader.position) leader = car;
  }
  return leader;
}

interface CameraRigState {
  shot: BroadcastShot;
  lastCutAt: number;
  lastSeenEventTick: number;
  sample: MutableCameraTrackSample;
  pose: CameraPose;
  desiredPosition: Vector3;
  lookTarget: Vector3;
  hasPose: boolean;
}

export function RaceCameras() {
  const camera = useThree((state) => state.camera);
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height));
  const selectedDriverId = useRaceStore((state) => state.selectedDriverId);
  const cameraMode = useRaceStore((state) => state.cameraMode);
  const reducedMotion = useReducedMotion();
  const rig = useRef<CameraRigState | null>(null);
  if (!rig.current) {
    const state = raceStore.getState();
    rig.current = {
      shot: {
        action: 'cut', reason: 'running',
        targetDriverId: trackedCar(state.snapshot.cars, state.selectedDriverId)?.driverId ?? null,
        secondaryDriverId: null, eventTick: null, anchorIndex: 0,
      },
      lastCutAt: state.snapshot.elapsedSeconds - 10,
      lastSeenEventTick: -1,
      sample: { x: 0, y: 0, z: 0, tangentX: 0, tangentY: 0, tangentZ: 1 },
      pose: { position: new Vector3(), target: new Vector3(), fov: 38 },
      desiredPosition: new Vector3(),
      lookTarget: new Vector3(),
      hasPose: false,
    };
  }

  useEffect(() => {
    const update = (state: RaceStoreState) => {
      const current = rig.current!;
      if (cameraMode === 'broadcast') {
        const decision = selectBroadcastShot({
          now: state.snapshot.elapsedSeconds,
          lastCutAt: current.lastCutAt,
          events: state.eventFeed,
          cars: state.snapshot.cars,
          selectedDriverId,
          currentShot: current.shot,
          cameraMode,
          reducedMotion,
          anchorCount: MONACO_TRACK.cameraAnchors.length,
          lastSeenEventTick: current.lastSeenEventTick,
        });
        if (decision.action === 'cut') {
          current.shot = decision;
          current.lastCutAt = state.snapshot.elapsedSeconds;
          if (decision.eventTick !== null) {
            current.lastSeenEventTick = Math.max(current.lastSeenEventTick, decision.eventTick);
          }
        }
      }

      const targetId = cameraMode === 'broadcast' ? current.shot.targetDriverId : selectedDriverId;
      const car = trackedCar(state.snapshot.cars, targetId) ?? state.snapshot.cars[0];
      const line: CameraTrackLine = car.targetLine === 'pit' || car.pitState !== 'track'
        ? 'pit'
        : car.targetLine === 'racing' ? 'center' : car.targetLine;
      sampleCameraTrackInto(
        TRACK_CACHE,
        line === 'pit' ? car.pitProgress : car.distance,
        line === 'pit' ? 0 : car.lateralOffset,
        line,
        current.sample,
      );
      const anchor = MONACO_TRACK.cameraAnchors[current.shot.anchorIndex % MONACO_TRACK.cameraAnchors.length];
      current.hasPose = calculateCameraPoseInto(cameraMode, current.sample, anchor, aspect, current.pose);
    };

    update(raceStore.getState());
    return raceStore.subscribe(update);
  }, [aspect, cameraMode, reducedMotion, selectedDriverId]);

  useFrame(({ clock }, delta) => {
    const current = rig.current!;
    if (!current.hasPose || cameraMode === 'free') return;
    const damping = 1 - Math.exp(-Math.min(delta, 0.1) * (reducedMotion ? 4.5 : 7.5));
    current.desiredPosition.copy(current.pose.position);
    if (cameraMode === 'broadcast') {
      const shake = reducedMotion ? 0.012 : 0.065;
      current.desiredPosition.x += Math.sin(clock.elapsedTime * 2.1) * shake;
      current.desiredPosition.y += Math.sin(clock.elapsedTime * 2.9) * shake * 0.45;
    }
    camera.position.lerp(current.desiredPosition, damping);
    current.lookTarget.lerp(current.pose.target, damping);
    camera.lookAt(current.lookTarget);
    if (camera instanceof PerspectiveCamera && Math.abs(camera.fov - current.pose.fov) > 0.01) {
      camera.fov += (current.pose.fov - camera.fov) * damping;
      camera.updateProjectionMatrix();
    }
  });

  return cameraMode === 'free' ? (
    <OrbitControls makeDefault enableDamping dampingFactor={0.08} target={FREE_TARGET} minDistance={8} maxDistance={240} />
  ) : null;
}
