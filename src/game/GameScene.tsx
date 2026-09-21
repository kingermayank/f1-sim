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
    audio.update(after.rpm, after.gear, controls.throttle, after.car.slip, after.car.speed);
    if (after.hitWall && after.car.speed > 8) audio.thud(Math.min(1, after.car.speed / 60));
  });
  return null;
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
    const line = car.targetLine === 'pit' || car.pitState !== 'track'
      ? 'pit'
      : car.targetLine === 'racing' ? 'center' : car.targetLine;
    const transform = SPLINE.sample(line === 'pit' ? car.pitProgress : car.distance, line === 'pit' ? 0 : car.lateralOffset, line);
    object.position.copy(transform.position);
    object.quaternion.copy(transform.rotation);
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

/** Chase camera: behind and above the player, damped, looking a little ahead. */
function ChaseCamera() {
  const camera = useThree((state) => state.camera);
  const desired = useMemo(() => new Vector3(), []);
  const look = useMemo(() => new Vector3(), []);
  const target = useMemo(() => new Vector3(), []);
  const snapped = useRef(false);

  useFrame((_, delta) => {
    const { car, surfaceY } = gameStore.getState();
    const surface = { y: surfaceY };
    const speedFraction = Math.min(1, car.speed / 85);
    const back = 9 + speedFraction * 5;
    const up = 3.2 + speedFraction * 1.2;
    desired.set(
      car.x - Math.cos(car.heading) * back,
      surface.y + up,
      car.z - Math.sin(car.heading) * back,
    );
    look.set(car.x + Math.cos(car.heading) * 12, surface.y + 1.2, car.z + Math.sin(car.heading) * 12);
    // Snap on the first frame so the race never opens on a camera gliding in
    // from its far initial position; damp from then on.
    const k = snapped.current ? 1 - Math.exp(-Math.min(delta, 0.1) * 6) : 1;
    snapped.current = true;
    camera.position.lerp(desired, k);
    target.lerp(look, k);
    camera.lookAt(target);
    if (camera instanceof PerspectiveCamera) {
      const fov = 62 + speedFraction * 10;
      if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * k; camera.updateProjectionMatrix(); }
    }
  });
  return null;
}

export function GameScene({ muted }: { muted: boolean }) {
  return (
    <Canvas
      className="race-canvas"
      shadows
      dpr={[1, 1.5]}
      camera={{ position: [-120, 8, 380], fov: 62, near: 0.5, far: 9000 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
    >
      <Environment quality="high" />
      <AiField />
      <PlayerCar />
      <ChaseCamera />
      <GameLoop muted={muted} />
    </Canvas>
  );
}
