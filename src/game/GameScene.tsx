import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import { Environment } from '../scene/Environment';
import { SHANGHAI_TRACK } from '../track/shanghai-track';
import { createSplineTrack } from '../track/spline-track';
import { createEngineAudio } from './engine-audio';
import { gameStore, projectedTrack, useGameStore } from './game-store';
import { createKeyboardInput } from './input';
import { TeamCarModel } from './TeamCarModel';

const SPLINE = createSplineTrack(SHANGHAI_TRACK);
const MAX_STEP = 1 / 30;

/** Fixed-step game loop: reads input, steps the store, never touches React per frame. */
function GameLoop({ muted }: { muted: boolean }) {
  const input = useMemo(() => createKeyboardInput(), []);
  const audio = useMemo(() => createEngineAudio(), []);

  useEffect(() => {
    const begin = () => audio.start();
    window.addEventListener('keydown', begin, { once: true });
    window.addEventListener('pointerdown', begin, { once: true });
    return () => {
      window.removeEventListener('keydown', begin);
      window.removeEventListener('pointerdown', begin);
      input.dispose();
      audio.dispose();
    };
  }, [input, audio]);

  useEffect(() => audio.setMuted(muted), [audio, muted]);

  useFrame((_, delta) => {
    const state = gameStore.getState();
    if (input.consumeReset() && state.phase === 'racing') state.resetToTrack();
    const controls = input.read();
    // Sub-step so a dropped frame never teleports the car through a corner.
    let remaining = Math.min(delta, 0.25);
    while (remaining > 0) {
      const dt = Math.min(MAX_STEP, remaining);
      gameStore.getState().step(dt, controls);
      remaining -= dt;
    }
    const after = gameStore.getState();
    audio.update({
      rpm: after.rpm, gear: after.gear, throttle: controls.throttle, brake: controls.brake,
      slip: after.car.slip, speed: after.car.speed, onTrack: after.onTrack,
      rival: nearestRival(after),
    });
    if (after.hitWall && after.car.speed > 8) audio.thud(Math.min(1, after.car.speed / 60));
    if (after.hitCar > 0.05) audio.thud(Math.min(1, 0.3 + after.hitCar * 0.7));
  });
  return null;
}

/** The nearest running rival: distance in metres and which side it is on, for the audio field. */
function nearestRival(state: ReturnType<typeof gameStore.getState>): { distance: number; pan: number } | null {
  let best: { distance: number; pan: number } | null = null;
  const forwardX = Math.cos(state.car.heading);
  const forwardZ = Math.sin(state.car.heading);
  for (const rival of state.ai) {
    if (rival.status !== 'running' || rival.pitState !== 'track') continue;
    const progress = rival.lap + rival.distance;
    const along = (progress - (state.lap + state.fraction)) * projectedTrack.lengthMeters;
    if (Math.abs(along) > 60) continue;
    const { point } = projectedTrack.at(rival.distance, rival.lateralOffset);
    const dx = point.x - state.car.x;
    const dz = point.z - state.car.z;
    const distance = Math.hypot(dx, dz);
    if (best && distance >= best.distance) continue;
    // Right of the player is +1: the right vector is (sin h, -cos h).
    const right = (dx * forwardZ - dz * forwardX) / Math.max(1, distance);
    best = { distance, pan: Math.max(-1, Math.min(1, right)) };
  }
  return best;
}

/** The player's car, driven from the store's free-moving state. */
function PlayerCar() {
  const group = useRef<Group>(null);
  const driverId = useGameStore((state) => state.driverId);
  const teamId = DRIVERS_2026.find((driver) => driver.id === driverId)?.teamId ?? TEAMS_2026[0].id;

  useFrame(() => {
    const object = group.current;
    if (!object) return;
    const { car, surfaceY, bodyRoll, bodyPitch } = gameStore.getState();
    // Height comes from the track point directly under the car — never from
    // the terrain, which drops away steeply outside the circuit.
    object.position.set(car.x, surfaceY, car.z);
    // Model noses face -Z; heading 0 faces +X. Roll and pitch sell the weight.
    object.rotation.set(bodyPitch, -car.heading + Math.PI / 2, bodyRoll, 'YXZ');
  });

  return (
    <group ref={group} name="player-car">
      <Suspense fallback={null}><TeamCarModel teamId={teamId} /></Suspense>
    </group>
  );
}

/** One AI car on the spline. Position is read imperatively each frame. */
function AiCar({ driverId, teamId }: { driverId: string; teamId: string }) {
  const group = useRef<Group>(null);
  useFrame(() => {
    const object = group.current;
    if (!object) return;
    const car = gameStore.getState().ai.find((candidate) => candidate.driverId === driverId);
    if (!car) return;
    if (car.targetLine === 'pit' || car.pitState !== 'track') {
      const transform = SPLINE.sample(car.pitProgress, 0, 'pit');
      object.position.copy(transform.position);
      object.quaternion.copy(transform.rotation);
    } else {
      // On track, rivals are drawn exactly where the contact model puts them:
      // on the centre curve plus their lateral offset.
      const { point, tangent } = projectedTrack.at(car.distance, car.lateralOffset);
      object.position.copy(point);
      object.rotation.set(0, -Math.atan2(tangent.z, tangent.x) + Math.PI / 2, 0);
    }
    object.visible = car.status !== 'retired';
  });
  return (
    <group ref={group} name={`ai-car-${driverId}`}>
      <Suspense fallback={null}><TeamCarModel teamId={teamId} /></Suspense>
    </group>
  );
}

function AiField() {
  const ai = useGameStore((state) => state.ai.map((car) => car.driverId).join(','));
  const ids = ai ? ai.split(',') : [];
  return (
    <>
      {ids.map((driverId) => {
        const driver = DRIVERS_2026.find((candidate) => candidate.id === driverId);
        return driver ? <AiCar key={driverId} driverId={driverId} teamId={driver.teamId} /> : null;
      })}
    </>
  );
}

/**
 * Chase camera: behind and above the player, looking a little ahead.
 *
 * The damping is on the camera's OFFSET from the car, not on its world
 * position. The car is always the origin, so a dropped frame moves camera and
 * car together and the car can never run out of shot; what is damped is the
 * swing around the car as it turns, which is the part that should feel heavy.
 */
function ChaseCamera() {
  const camera = useThree((state) => state.camera);
  const offset = useMemo(() => new Vector3(), []);
  const desiredOffset = useMemo(() => new Vector3(), []);
  const lookOffset = useMemo(() => new Vector3(), []);
  const desiredLook = useMemo(() => new Vector3(), []);
  const target = useMemo(() => new Vector3(), []);
  const snapped = useRef(false);

  useFrame((_, delta) => {
    const { car, surfaceY } = gameStore.getState();
    const speedFraction = Math.min(1, car.speed / 85);
    const back = 9 + speedFraction * 5;
    const up = 3.2 + speedFraction * 1.2;
    desiredOffset.set(-Math.cos(car.heading) * back, up, -Math.sin(car.heading) * back);
    desiredLook.set(Math.cos(car.heading) * 12, 1.2, Math.sin(car.heading) * 12);
    // Snap on the first frame so the race never opens on a camera gliding in
    // from its far initial position; damp from then on.
    const k = snapped.current ? 1 - Math.exp(-Math.min(delta, 0.1) * 6) : 1;
    snapped.current = true;
    offset.lerp(desiredOffset, k);
    lookOffset.lerp(desiredLook, k);
    camera.position.set(car.x + offset.x, surfaceY + offset.y, car.z + offset.z);
    target.set(car.x + lookOffset.x, surfaceY + lookOffset.y, car.z + lookOffset.z);
    camera.lookAt(target);
    if (camera instanceof PerspectiveCamera) {
      const fov = 62 + speedFraction * 10;
      if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * k; camera.updateProjectionMatrix(); }
    }
  });
  return null;
}

/** Where the shadow frustum should sit: on the player's car. */
function playerFocus() {
  const { car, surfaceY } = gameStore.getState();
  return { x: car.x, y: surfaceY, z: car.z };
}

export function GameScene({ muted }: { muted: boolean }) {
  return (
    <Canvas
      className="race-canvas"
      shadows
      dpr={[1, 1.5]}
      // A logarithmic depth buffer: the chase camera looks along the road at a
      // grazing angle, and with a 9 km far plane the painted lines and kerbs
      // would otherwise fight the tarmac for depth and flicker.
      camera={{ position: [-120, 8, 380], fov: 62, near: 1, far: 9000 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true }}
    >
      <Environment quality="high" shadowFocus={playerFocus} />
      <AiField />
      <PlayerCar />
      <ChaseCamera />
      <GameLoop muted={muted} />
    </Canvas>
  );
}
