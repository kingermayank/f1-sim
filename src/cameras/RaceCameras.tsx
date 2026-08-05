import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PerspectiveCamera, Vector3 } from 'three';
import type { CameraMode } from '../store/race-store';
import { useRaceStore } from '../store/race-store';
import type { CarState } from '../simulation/events';
import { MONACO_TRACK } from '../track/monaco-track';
import { createSplineTrack } from '../track/spline-track';
import type { CameraAnchor, TrackTransform } from '../track/track-types';
import { selectBroadcastShot, type BroadcastShot } from './camera-director';

const TRACK = createSplineTrack(MONACO_TRACK);

function trackCenterAndHeight(): { target: Vector3; position: Vector3 } {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of MONACO_TRACK.centerLine) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  const target = new Vector3((minX + maxX) / 2, 2, (minZ + maxZ) / 2);
  return { target, position: new Vector3(target.x, Math.max(maxX - minX, maxZ - minZ) * 1.15, target.z + 0.01) };
}

const OVERHEAD = trackCenterAndHeight();
const FREE_TARGET: [number, number, number] = [OVERHEAD.target.x, OVERHEAD.target.y, OVERHEAD.target.z];

export interface CameraPose {
  position: Vector3;
  target: Vector3;
  fov: number;
}

/** Pure pose math, kept outside the frame loop and usable in non-WebGL tests. */
export function calculateCameraPose(
  mode: CameraMode,
  transform: TrackTransform,
  anchor: CameraAnchor,
): CameraPose | null {
  if (mode === 'free') return null;
  if (mode === 'overhead') {
    return { position: OVERHEAD.position.clone(), target: OVERHEAD.target.clone(), fov: 42 };
  }

  const tangent = transform.tangent;
  if (mode === 'broadcast') {
    return {
      position: new Vector3(anchor.position.x, anchor.position.y, anchor.position.z),
      target: transform.position.clone().add(new Vector3(anchor.targetOffset.x, anchor.targetOffset.y, anchor.targetOffset.z)),
      fov: 38,
    };
  }
  if (mode === 'cockpit') {
    return {
      position: transform.position.clone().addScaledVector(tangent, 0.65).add(new Vector3(0, 1.05, 0)),
      target: transform.position.clone().addScaledVector(tangent, 12).add(new Vector3(0, 0.8, 0)),
      fov: 58,
    };
  }
  return {
    position: transform.position.clone().addScaledVector(tangent, -7).add(new Vector3(0, 3.2, 0)),
    target: transform.position.clone().addScaledVector(tangent, 6).add(new Vector3(0, 0.8, 0)),
    fov: 48,
  };
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

function carTransform(car: CarState): TrackTransform {
  if (car.targetLine === 'pit' || car.pitState !== 'track') return TRACK.sample(car.pitProgress, 0, 'pit');
  const line = car.targetLine === 'racing' ? 'center' : car.targetLine;
  return TRACK.sample(car.distance, car.lateralOffset, line);
}

export function RaceCameras() {
  const camera = useThree((state) => state.camera);
  const snapshot = useRaceStore((state) => state.snapshot);
  const events = useRaceStore((state) => state.eventFeed);
  const selectedDriverId = useRaceStore((state) => state.selectedDriverId);
  const cameraMode = useRaceStore((state) => state.cameraMode);
  const reducedMotion = useReducedMotion();
  const initialDriver = trackedCar(snapshot.cars, selectedDriverId)?.driverId ?? null;
  const [shot, setShot] = useState<BroadcastShot>({
    action: 'cut', reason: 'running', targetDriverId: initialDriver,
    secondaryDriverId: null, eventTick: null, anchorIndex: 0,
  });
  const shotRef = useRef(shot);
  const lastCutAt = useRef(snapshot.elapsedSeconds - 10);
  const lookTarget = useRef(new Vector3());
  const desiredPosition = useRef(new Vector3());

  useEffect(() => {
    if (cameraMode !== 'broadcast') return;
    const decision = selectBroadcastShot({
      now: snapshot.elapsedSeconds,
      lastCutAt: lastCutAt.current,
      events,
      cars: snapshot.cars,
      selectedDriverId,
      currentShot: shotRef.current,
      cameraMode,
      reducedMotion,
      anchorCount: MONACO_TRACK.cameraAnchors.length,
    });
    if (decision.action !== 'cut') return;
    shotRef.current = decision;
    lastCutAt.current = snapshot.elapsedSeconds;
    setShot(decision);
  }, [cameraMode, events, reducedMotion, selectedDriverId, snapshot]);

  const targetId = cameraMode === 'broadcast' ? shot.targetDriverId : selectedDriverId;
  const car = useMemo(() => trackedCar(snapshot.cars, targetId), [snapshot.cars, targetId]);
  const transform = useMemo(() => carTransform(car ?? snapshot.cars[0]), [car, snapshot.cars]);
  const anchor = MONACO_TRACK.cameraAnchors[shot.anchorIndex % MONACO_TRACK.cameraAnchors.length];
  const pose = useMemo(() => calculateCameraPose(cameraMode, transform, anchor), [anchor, cameraMode, transform]);

  useFrame(({ clock }, delta) => {
    if (!pose || cameraMode === 'free') return;
    const damping = 1 - Math.exp(-Math.min(delta, 0.1) * (reducedMotion ? 4.5 : 7.5));
    desiredPosition.current.copy(pose.position);
    if (cameraMode === 'broadcast') {
      const shake = reducedMotion ? 0.012 : 0.065;
      desiredPosition.current.x += Math.sin(clock.elapsedTime * 2.1) * shake;
      desiredPosition.current.y += Math.sin(clock.elapsedTime * 2.9) * shake * 0.45;
    }
    camera.position.lerp(desiredPosition.current, damping);
    lookTarget.current.lerp(pose.target, damping);
    camera.lookAt(lookTarget.current);
    if (camera instanceof PerspectiveCamera && Math.abs(camera.fov - pose.fov) > 0.01) {
      camera.fov += (pose.fov - camera.fov) * damping;
      camera.updateProjectionMatrix();
    }
  });

  return cameraMode === 'free' ? (
    <OrbitControls makeDefault enableDamping dampingFactor={0.08} target={FREE_TARGET} minDistance={8} maxDistance={240} />
  ) : null;
}
