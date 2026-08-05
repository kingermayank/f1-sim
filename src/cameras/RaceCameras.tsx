import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Box3, type Camera, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { raceStore, useRaceStore, type CameraMode, type RaceStoreState } from '../store/race-store';
import type { CarState } from '../simulation/events';
import { SHANGHAI_TRACK } from '../track/shanghai-track';
import { createSplineTrack } from '../track/spline-track';
import type { CameraAnchor, TrackPoint, TrackTransform } from '../track/track-types';
import {
  newestBroadcastEventTick,
  selectBroadcastShot,
  shouldEvaluateBroadcastShot,
  type BroadcastShot,
} from './camera-director';

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

export interface ProjectedBoxMeasurement {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  inFrustum: boolean;
}

export function measureProjectedBox(box: Box3, camera: Camera): ProjectedBoxMeasurement {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const projected = new Vector3(x, y, z).project(camera);
        minX = Math.min(minX, projected.x);
        maxX = Math.max(maxX, projected.x);
        minY = Math.min(minY, projected.y);
        maxY = Math.max(maxY, projected.y);
        minZ = Math.min(minZ, projected.z);
        maxZ = Math.max(maxZ, projected.z);
      }
    }
  }
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: (maxX - minX) / 2,
    height: (maxY - minY) / 2,
    inFrustum: maxX >= -1 && minX <= 1 && maxY >= -1 && minY <= 1 && maxZ >= -1 && minZ <= 1,
  };
}

declare global {
  interface Window {
    __RACE_SCENE_DIAGNOSTICS__?: {
      cameraMode: CameraMode;
      targetDriverId: string | null;
      targetDistance: number;
      projected: ProjectedBoxMeasurement | null;
    };
  }
}

export function cameraBlendFactor(
  mode: CameraMode,
  reducedMotion: boolean,
  delta: number,
  broadcastCut: boolean,
): number {
  if (mode === 'broadcast') return 1;
  // A fixed trackside camera should cut cleanly to its new position rather than
  // fly across the circuit, so a pending cut snaps.
  if (mode === 'trackside' && broadcastCut) return 1;
  const rate = mode === 'cockpit' ? 9
    : mode === 'chase' ? 7.5
    : mode === 'trackside' ? (reducedMotion ? 6 : 9)
    : mode === 'drone' ? (reducedMotion ? 3.2 : 4.2)
    : mode === 'aerial' ? (reducedMotion ? 3.5 : 5)
    : reducedMotion ? 4.5 : 6;
  return 1 - Math.exp(-Math.min(delta, 0.1) * rate);
}

/** Nearest curated trackside camera to a point on the lap. */
export function nearestAnchorIndex(distance: number): number {
  const anchors = SHANGHAI_TRACK.cameraAnchors;
  let best = 0;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let index = 0; index < anchors.length; index += 1) {
    const raw = Math.abs(anchors[index].distance - distance);
    const gap = Math.min(raw, 1 - raw);
    if (gap < bestGap) {
      bestGap = gap;
      best = index;
    }
  }
  return best;
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

const TRACK_BOUNDS = calculateTrackBounds(SHANGHAI_TRACK.centerLine);

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

const TRACK_CACHE = createCameraTrackSampleCache(createSplineTrack(SHANGHAI_TRACK));
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
    const portrait = aspect < 0.8;
    const side = Math.round(anchor.distance * 100) % 2 === 0 ? -1 : 1;
    const lateralX = -sample.tangentZ * side;
    const lateralZ = sample.tangentX * side;
    output.position.set(
      sample.x - sample.tangentX * 22 + lateralX * 10,
      sample.y + (portrait ? 21 : 22),
      sample.z - sample.tangentZ * 22 + lateralZ * 10,
    );
    output.target.set(
      sample.x + sample.tangentX * 0.5 + anchor.targetOffset.x,
      sample.y + 0.55 + anchor.targetOffset.y,
      sample.z + sample.tangentZ * 0.5 + anchor.targetOffset.z,
    );
    output.fov = portrait ? 46 : 44;
    return true;
  }
  if (mode === 'trackside') {
    // A fixed camera at a curated Shanghai location. The lens tightens with
    // distance so the car stays large from a stationary position.
    const portrait = aspect < 0.8;
    output.position.set(anchor.position.x, anchor.position.y, anchor.position.z);
    output.target.set(
      sample.x + anchor.targetOffset.x,
      sample.y + anchor.targetOffset.y,
      sample.z + anchor.targetOffset.z,
    );
    const range = Math.hypot(anchor.position.x - sample.x, anchor.position.z - sample.z);
    output.fov = Math.min(portrait ? 40 : 36, Math.max(12, 1250 / Math.max(20, range)));
    return true;
  }
  if (mode === 'aerial') {
    // High oblique: the car sits low in frame with the corner ahead visible.
    const portrait = aspect < 0.8;
    output.position.set(
      sample.x - sample.tangentX * 62,
      sample.y + (portrait ? 118 : 96),
      sample.z - sample.tangentZ * 62,
    );
    output.target.set(
      sample.x + sample.tangentX * 26,
      sample.y + anchor.targetOffset.y,
      sample.z + sample.tangentZ * 26,
    );
    output.fov = portrait ? 46 : 40;
    return true;
  }
  if (mode === 'drone') {
    // Elevated follow, offset to one side so the car is not hidden by its own
    // rear wing. The side alternates per anchor so successive shots vary.
    const portrait = aspect < 0.8;
    const side = Math.round(anchor.distance * 100) % 2 === 0 ? -1 : 1;
    const lateralX = -sample.tangentZ * side;
    const lateralZ = sample.tangentX * side;
    output.position.set(
      sample.x - sample.tangentX * 27 + lateralX * 15,
      sample.y + 15.5,
      sample.z - sample.tangentZ * 27 + lateralZ * 15,
    );
    output.target.set(
      sample.x + sample.tangentX * 7,
      sample.y + 1.15 + anchor.targetOffset.y,
      sample.z + sample.tangentZ * 7,
    );
    output.fov = portrait ? 44 : 39;
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
  /** Curated camera currently in use; trackside picks its own, others follow the shot. */
  anchorIndex: number;
  lastCutAt: number;
  lastSeenEventTick: number;
  sample: MutableCameraTrackSample;
  pose: CameraPose;
  desiredPosition: Vector3;
  lookTarget: Vector3;
  hasPose: boolean;
  snapPending: boolean;
  targetDriverId: string | null;
  lastDiagnosticAt: number;
  visualSample: MutableCameraTrackSample;
  targetPosition: Vector3;
  targetQuaternion: Quaternion;
  targetTangent: Vector3;
}

export function RaceCameras() {
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height));
  const selectedDriverId = useRaceStore((state) => state.selectedDriverId);
  const cameraMode = useRaceStore((state) => state.cameraMode);
  const reducedMotion = useRaceStore((state) => state.reducedMotion);
  const rig = useRef<CameraRigState | null>(null);
  if (!rig.current) {
    const state = raceStore.getState();
    rig.current = {
      shot: {
        action: 'cut', reason: 'running',
        targetDriverId: trackedCar(state.snapshot.cars, state.selectedDriverId)?.driverId ?? null,
        secondaryDriverId: null, eventTick: null, anchorIndex: 0,
      },
      anchorIndex: 0,
      lastCutAt: state.snapshot.elapsedSeconds - 10,
      lastSeenEventTick: -1,
      sample: { x: 0, y: 0, z: 0, tangentX: 0, tangentY: 0, tangentZ: 1 },
      pose: { position: new Vector3(), target: new Vector3(), fov: 38 },
      desiredPosition: new Vector3(),
      lookTarget: new Vector3(),
      hasPose: false,
      snapPending: true,
      targetDriverId: null,
      lastDiagnosticAt: Number.NEGATIVE_INFINITY,
      visualSample: { x: 0, y: 0, z: 0, tangentX: 0, tangentY: 0, tangentZ: 1 },
      targetPosition: new Vector3(),
      targetQuaternion: new Quaternion(),
      targetTangent: new Vector3(0, 0, 1),
    };
  }

  useEffect(() => {
    rig.current!.snapPending = cameraMode === 'broadcast' || cameraMode === 'overhead';
    const update = (state: RaceStoreState) => {
      const current = rig.current!;
      if (cameraMode === 'broadcast' && shouldEvaluateBroadcastShot(
        state.snapshot.elapsedSeconds,
        current.lastCutAt,
        state.eventFeed,
        current.lastSeenEventTick,
        reducedMotion,
      )) {
        const decision = selectBroadcastShot({
          now: state.snapshot.elapsedSeconds,
          lastCutAt: current.lastCutAt,
          events: state.eventFeed,
          cars: state.snapshot.cars,
          selectedDriverId,
          currentShot: current.shot,
          cameraMode,
          reducedMotion,
          anchorCount: SHANGHAI_TRACK.cameraAnchors.length,
          lastSeenEventTick: current.lastSeenEventTick,
        });
        current.lastSeenEventTick = newestBroadcastEventTick(state.eventFeed, current.lastSeenEventTick);
        if (decision.action === 'cut') {
          current.shot = decision;
          current.lastCutAt = state.snapshot.elapsedSeconds;
          current.snapPending = true;
        }
      }

      const targetId = cameraMode === 'broadcast' ? current.shot.targetDriverId : selectedDriverId;
      const car = trackedCar(state.snapshot.cars, targetId) ?? state.snapshot.cars[0];
      current.targetDriverId = car.driverId;
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
      // Trackside follows the curated camera closest to the car; the other
      // modes ride the director's current shot.
      const anchorIndex = cameraMode === 'trackside'
        ? nearestAnchorIndex(line === 'pit' ? 0 : car.distance)
        : current.shot.anchorIndex;
      if (cameraMode === 'trackside' && anchorIndex !== current.anchorIndex) current.snapPending = true;
      current.anchorIndex = anchorIndex;
      const anchor = SHANGHAI_TRACK.cameraAnchors[anchorIndex % SHANGHAI_TRACK.cameraAnchors.length];
      current.hasPose = calculateCameraPoseInto(cameraMode, current.sample, anchor, aspect, current.pose);
    };

    update(raceStore.getState());
    return raceStore.subscribe(update);
  }, [aspect, cameraMode, reducedMotion, selectedDriverId]);

  useFrame(({ clock }, delta) => {
    const current = rig.current!;
    if (!current.hasPose || cameraMode === 'free') return;
    const targetObject = current.targetDriverId ? scene.getObjectByName(`car-${current.targetDriverId}`) : undefined;
    // Modes that frame a car track the rendered object rather than the raw
    // spline sample, so the subject stays centred as it moves between ticks.
    const followsCar = cameraMode === 'broadcast'
      || cameraMode === 'trackside'
      || cameraMode === 'aerial'
      || cameraMode === 'drone';
    if (followsCar && targetObject) {
      targetObject.getWorldPosition(current.targetPosition);
      targetObject.getWorldQuaternion(current.targetQuaternion);
      current.targetTangent.set(0, 0, 1).applyQuaternion(current.targetQuaternion).normalize();
      current.visualSample.x = current.targetPosition.x;
      current.visualSample.y = current.targetPosition.y;
      current.visualSample.z = current.targetPosition.z;
      current.visualSample.tangentX = current.targetTangent.x;
      current.visualSample.tangentY = current.targetTangent.y;
      current.visualSample.tangentZ = current.targetTangent.z;
      const anchor = SHANGHAI_TRACK.cameraAnchors[current.anchorIndex % SHANGHAI_TRACK.cameraAnchors.length];
      calculateCameraPoseInto(cameraMode, current.visualSample, anchor, aspect, current.pose);
    }
    const damping = cameraBlendFactor(cameraMode, reducedMotion, delta, current.snapPending);
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
    current.snapPending = false;
    if (clock.elapsedTime - current.lastDiagnosticAt >= 0.2) {
      let projected: ProjectedBoxMeasurement | null = null;
      let targetDistance = Number.POSITIVE_INFINITY;
      if (targetObject) {
        const box = new Box3().setFromObject(targetObject);
        if (!box.isEmpty()) {
          projected = measureProjectedBox(box, camera);
          targetDistance = camera.position.distanceTo(box.getCenter(new Vector3()));
        }
      }
      window.__RACE_SCENE_DIAGNOSTICS__ = {
        cameraMode,
        targetDriverId: current.targetDriverId,
        targetDistance,
        projected,
      };
      current.lastDiagnosticAt = clock.elapsedTime;
    }
  });

  return cameraMode === 'free' ? (
    <OrbitControls makeDefault enableDamping dampingFactor={0.08} target={FREE_TARGET} minDistance={8} maxDistance={240} />
  ) : null;
}
