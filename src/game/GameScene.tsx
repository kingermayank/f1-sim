import { PerformanceMonitor, useProgress } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CanvasTexture, Group, Mesh, PerspectiveCamera, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import { F1Car, type CarMotion } from '../car/F1Car';
import { liveryFor } from '../car/liveries';
import { SHANGHAI_TRACK } from '../track/shanghai-track';
import { createSplineTrack } from '../track/spline-track';
import { createEngineAudio } from './engine-audio';
import { INTRO_SECONDS, gameStore, projectedTrack, rivalSpeedMps, useGameStore } from './game-store';
import { getPlayerInput } from './input';
import { GuideLine } from './GuideLine';
import { CarFillLights } from './TeamCarModel';
import { RaceReady } from './RaceReady';
import { kerbAt } from '../track/circuit-layout';
import { CarEffects } from './CarEffects';
import { RaceWorld } from './RaceWorld';

const SPLINE = createSplineTrack(SHANGHAI_TRACK);

/** An 8×6 chequer, drawn once on a canvas. */
function useChequerTexture() {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 64;
    const context = canvas.getContext('2d')!;
    for (let row = 0; row < 6; row += 1) {
      for (let column = 0; column < 9; column += 1) {
        context.fillStyle = (row + column) % 2 === 0 ? '#111' : '#f4f4f4';
        context.fillRect(column * 10.667, row * 10.667, 11, 11);
      }
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }, []);
}
const MAX_STEP = 1 / 30;

/** Fixed-step game loop: reads input, steps the store, never touches React per frame. */
function GameLoop({ muted }: { muted: boolean }) {
  const input = useMemo(() => getPlayerInput(), []);
  const audio = useMemo(() => createEngineAudio(), []);

  useEffect(() => {
    // The click that started the race is a user gesture, so the context can
    // usually run straight away; if the browser still holds it, any key or
    // pointer resumes it.
    const begin = () => audio.start();
    begin();
    window.addEventListener('keydown', begin);
    window.addEventListener('pointerdown', begin);
    return () => {
      window.removeEventListener('keydown', begin);
      window.removeEventListener('pointerdown', begin);
      input.setTouch(null);
      audio.dispose();
    };
  }, [input, audio]);

  useEffect(() => audio.setMuted(muted), [audio, muted]);

  const lastLights = useRef(0);
  // Starts at 'setup' so the first frame applies the levels for whatever phase the race is in.
  const lastPhase = useRef<ReturnType<typeof gameStore.getState>['phase']>('setup');
  const lastEventId = useRef(0);
  const wasReady = useRef(false);
  const loading = useProgress((state) => state.active);

  useFrame((_, delta) => {
    const state = gameStore.getState();
    // The intro waits for loaded assets and a rendered player model.
    if ((loading || !state.ready) && state.phase === 'intro') { wasReady.current = false; return; }
    const controls = input.read();
    let skip = input.consumeSkip();
    let pause = input.consumePause();
    // The key that dismissed the loading screen must not also skip the intro.
    if (!wasReady.current) { wasReady.current = true; skip = false; pause = false; }
    if (input.consumeReset() && state.phase === 'racing' && !state.paused) state.resetToTrack();
    // One pad button covers both: it skips the intro, and pauses once the race is on.
    if (state.phase === 'intro') { if (skip) state.skipIntro(); } else if (pause) state.togglePause();
    if (gameStore.getState().paused) {
      audio.update({ rpm: 0.12, gear: 1, throttle: 0, brake: 0, slip: 0, speed: 0, onTrack: true, rival: null });
      return;
    }
    // Sub-step so a dropped frame never teleports the car through a corner.
    let remaining = Math.min(delta, 0.25);
    while (remaining > 0) {
      const dt = Math.min(MAX_STEP, remaining);
      gameStore.getState().step(dt, controls);
      remaining -= dt;
    }
    const after = gameStore.getState();

    // Moments: each gantry light, lights out, and the crowd bed by phase.
    if (after.phase === 'lights' && after.lights !== lastLights.current) {
      if (after.lights > lastLights.current) audio.light(after.lights - 1);
      lastLights.current = after.lights;
    }
    if (after.phase !== lastPhase.current) {
      if (after.phase === 'racing' && lastPhase.current === 'lights') audio.lightsOut();
      if (after.phase === 'lights') lastLights.current = 0;
      audio.setAmbience(after.phase === 'intro' ? 0.6 : after.phase === 'lights' ? 0.7 : after.phase === 'finished' ? 0.8 : 0.25);
      audio.setIntro(after.phase === 'intro' ? 1 : 0);
      lastPhase.current = after.phase;
    }
    const newest = after.events[after.events.length - 1];
    if (newest && newest.id !== lastEventId.current) {
      lastEventId.current = newest.id;
      if (newest.kind === 'pass' || newest.kind === 'passed') audio.passBy(nearestRival(after)?.pan ?? 0);
    }

    audio.update({
      rpm: after.rpm, gear: after.gear, throttle: after.throttle, brake: after.brake,
      slip: after.car.slip, speed: after.car.speed, onTrack: after.onTrack,
      rival: nearestRival(after),
    });
    if (after.hitWall && after.car.speed > 8) audio.thud(Math.min(1, after.car.speed / 60));
    if (after.hitCar > 0.05) audio.thud(Math.min(1, 0.3 + after.hitCar * 0.7));
  });
  return null;
}

/** Lights lit on the start gantry: counting up during the start, dark otherwise. */
function litStartLights(): number {
  const { phase, lights } = gameStore.getState();
  return phase === 'lights' ? lights : 0;
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

/** Which of the team's two cars a driver has: the second carries the yellow camera pod. */
function seatOf(driverId: string, teamId: string): 'first' | 'second' {
  return DRIVERS_2026.find((driver) => driver.teamId === teamId)?.id === driverId ? 'first' : 'second';
}

/** Steering angle (radians) this far is drawn as full lock on the front wheels. */
const STEER_DISPLAY_LOCK = 0.3;

/** The player's car, driven from the store's free-moving state. */
function PlayerCar() {
  const group = useRef<Group>(null);
  const driverId = useGameStore((state) => state.driverId);
  const driver = DRIVERS_2026.find((candidate) => candidate.id === driverId);
  const teamId = driver?.teamId ?? TEAMS_2026[0].id;
  const motion = useRef<CarMotion>({ speed: 0, steer: 0, straight: false, brake: 0 });
  const lastSpeed = useRef(0);

  useFrame((_, delta) => {
    const object = group.current;
    if (!object) return;
    const { car, surfaceY, bodyRoll, bodyPitch, drsActive } = gameStore.getState();
    // Braking read back from the deceleration: heats the discs.
    const decel = delta > 0 ? (lastSpeed.current - car.speed) / Math.min(delta, 0.1) : 0;
    lastSpeed.current = car.speed;
    motion.current.brake = Math.max(0, Math.min(1, (decel - 6) / 20));
    // Height comes from the track point directly under the car — never from
    // the terrain, which drops away steeply outside the circuit.
    object.position.set(car.x, surfaceY, car.z);
    // Model noses face +Z; heading 0 faces +X. Roll and pitch sell the weight.
    object.rotation.set(bodyPitch, -car.heading + Math.PI / 2, bodyRoll, 'YXZ');
    // Positive steer turns the car to its right; the wheels turn the same way.
    motion.current.speed = car.speed;
    motion.current.steer = Math.max(-1, Math.min(1, -car.steer / STEER_DISPLAY_LOCK));
    motion.current.straight = drsActive;
  });

  return (
    <group ref={group} name="player-car">
      <F1Car livery={liveryFor(teamId)} number={driver?.number} pod={seatOf(driverId, teamId)} compound="medium" motion={motion} />
    </group>
  );
}

/** Beyond this distance from the player a rival draws its low-detail model; back inside the nearer one, the full model. */
const LOD_FAR_METRES = 48;
const LOD_NEAR_METRES = 36;
/** Only rivals this close cast shadows: the rest would render into the shadow map for nothing visible. */
const SHADOW_METRES = 40;

/**
 * One AI car on the spline. Position is read imperatively each frame. The car
 * draws its high-detail geometry near the player and its light one beyond,
 * switching with hysteresis so it never flickers at the boundary. Geometry is
 * shared and cached, so a switch is instant.
 */
function AiCar({ driverId, teamId }: { driverId: string; teamId: string }) {
  const group = useRef<Group>(null);
  const [near, setNear] = useState(false);
  const nearRef = useRef(false);
  const motion = useRef<CarMotion>({ speed: 0, steer: 0, straight: false });
  const number = DRIVERS_2026.find((driver) => driver.id === driverId)?.number;
  useFrame(() => {
    const object = group.current;
    if (!object) return;
    const state = gameStore.getState();
    const car = state.ai.find((candidate) => candidate.driverId === driverId);
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
    motion.current.speed = rivalSpeedMps(car, state.difficulty) * (state.phase === 'racing' || state.phase === 'finished' ? 1 : 0);
    // Front wheels follow the corner: the turn of the track over the next few metres.
    const ahead = projectedTrack.at(car.distance + 4 / projectedTrack.lengthMeters).tangent;
    const here = projectedTrack.at(car.distance).tangent;
    const turn = Math.atan2(here.x * ahead.z - here.z * ahead.x, here.x * ahead.x + here.z * ahead.z) / 4;
    motion.current.steer = Math.max(-1, Math.min(1, -Math.atan(turn * 3.6) / STEER_DISPLAY_LOCK));
    motion.current.straight = state.phase === 'racing' && projectedTrack.inPassingZone(car.distance) && car.lap >= 1;
    const distance = Math.hypot(object.position.x - state.car.x, object.position.z - state.car.z);
    const wantNear = nearRef.current ? distance < LOD_FAR_METRES : distance < LOD_NEAR_METRES;
    if (wantNear !== nearRef.current) { nearRef.current = wantNear; setNear(wantNear); }
    const casts = distance < SHADOW_METRES;
    if (object.userData.casts !== casts) {
      object.userData.casts = casts;
      object.traverse((child) => { if (child instanceof Mesh) child.castShadow = casts; });
    }
  });
  return (
    <group ref={group} name={`ai-car-${driverId}`}>
      <F1Car livery={liveryFor(teamId)} number={number} pod={seatOf(driverId, teamId)} detail={near ? 'high' : 'low'} compound="medium" motion={motion} castShadow={false} />
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
  const placement = useRef(gameStore.getState().placement);
  const intro = useMemo(() => createIntroShots(), []);
  const shakeTime = useRef(0);

  useFrame((_, delta) => {
    const { car, surfaceY, phase, introSeconds } = gameStore.getState();
    if (phase === 'intro') {
      intro.apply(camera, introSeconds, car, surfaceY);
      // The chase camera picks up from wherever the last shot leaves it.
      snapped.current = false;
      return;
    }
    // The car was placed rather than driven (a reset): jump with it instead
    // of swinging round from the old heading.
    const placed = gameStore.getState().placement;
    if (placed !== placement.current) { placement.current = placed; snapped.current = false; }
    const speedFraction = Math.min(1, car.speed / 85);
    // Stay on the car's centreline, directly behind its heading.
    const back = 9 + speedFraction * 4;
    const up = 3.6 + speedFraction * 1.1;
    desiredOffset.set(-Math.cos(car.heading) * back, up, -Math.sin(car.heading) * back);
    desiredLook.set(Math.cos(car.heading) * 2, 0.7, Math.sin(car.heading) * 2);
    // Snap on the first frame so the race never opens on a camera gliding in
    // from its far initial position; damp from then on.
    const k = snapped.current ? 1 - Math.exp(-Math.min(delta, 0.1) * 6) : 1;
    snapped.current = true;
    offset.lerp(desiredOffset, k);
    lookOffset.lerp(desiredLook, k);
    // A camera bolted to a car at speed: a fine tremor that grows with speed,
    // a hard buzz over the kerbs and a rougher one off the road.
    const state = gameStore.getState();
    const kerb = Math.abs(state.lateral) > projectedTrack.halfWidth && Math.abs(state.lateral) < 8.2
      && kerbAt(state.fraction, Math.sign(state.lateral) || 1);
    const roughness = state.phase === 'racing'
      ? speedFraction * 0.012 + (kerb ? 0.05 * Math.min(1, car.speed / 30) : 0) + (state.onTrack ? 0 : 0.08 * Math.min(1, car.speed / 25))
      : 0;
    shakeTime.current += Math.min(delta, 0.1);
    const t = shakeTime.current;
    const shakeY = roughness * (Math.sin(t * 61) * 0.6 + Math.sin(t * 37.3 + 1.1) * 0.4);
    const shakeX = roughness * 0.5 * Math.sin(t * 47.7 + 0.4);
    camera.position.set(car.x + offset.x + shakeX * -Math.sin(car.heading), surfaceY + offset.y + shakeY, car.z + offset.z + shakeX * Math.cos(car.heading));
    target.set(car.x + lookOffset.x, surfaceY + lookOffset.y + shakeY * 0.5, car.z + lookOffset.z);
    camera.lookAt(target);
    if (camera instanceof PerspectiveCamera) {
      const fov = 62 + speedFraction * 10;
      if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * k; camera.updateProjectionMatrix(); }
    }
  });
  return null;
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * The intro: three shots over the grid before the lights.
 *
 * 1. A slow aerial drift over the whole grid, the circuit's scale.
 * 2. A low trackside dolly past the cars at head height, the texture.
 * 3. A pull-in from behind the player's car to the chase position, so the
 *    cut to the lights is seamless.
 */
function createIntroShots() {
  const grid = projectedTrack.at(0.993);
  const centre = grid.point.clone();
  const forward = new Vector3(grid.tangent.x, 0, grid.tangent.z).normalize();
  const left = new Vector3(-forward.z, 0, forward.x);
  const up = new Vector3(0, 1, 0);
  const position = new Vector3();
  const look = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  const SHOT_A = 4.5;
  const SHOT_B = 8;

  const point = (out: Vector3, along: number, side: number, height: number, from = centre) => out
    .copy(from)
    .addScaledVector(forward, along)
    .addScaledVector(left, side)
    .addScaledVector(up, height);

  return {
    apply(camera: { position: Vector3; lookAt(target: Vector3): void; fov?: number; updateProjectionMatrix?: () => void }, seconds: number, car: { x: number; z: number; heading: number; speed: number }, surfaceY: number) {
      if (seconds < SHOT_A) {
        const t = smoothstep(seconds / SHOT_A);
        // Over the pit wall, clear of the pit building's roof and the grandstand's.
        point(a, -80, 14, 44);
        point(b, 30, 12, 28);
        position.lerpVectors(a, b, t);
        point(look, -20, 0, 0.5);
      } else if (seconds < SHOT_B) {
        const t = (seconds - SHOT_A) / (SHOT_B - SHOT_A);
        point(position, -62 + t * 78, -10.5, 1.5);
        point(look, -30 + t * 78, 0.5, 0.7);
      } else {
        const t = smoothstep((seconds - SHOT_B) / (INTRO_SECONDS - SHOT_B));
        const carPosition = new Vector3(car.x, surfaceY, car.z);
        const heading = new Vector3(Math.cos(car.heading), 0, Math.sin(car.heading));
        a.copy(carPosition).addScaledVector(heading, -34).addScaledVector(up, 14).addScaledVector(left, -8);
        b.copy(carPosition).addScaledVector(heading, -9).addScaledVector(up, 3.6).addScaledVector(left, -3.4);
        position.lerpVectors(a, b, t);
        look.copy(carPosition).addScaledVector(heading, 2).addScaledVector(up, 0.7);
      }
      camera.position.copy(position);
      camera.lookAt(look);
    },
  };
}

/**
 * The chequered flag, waved from the pit wall at the line once the player is
 * on the final lap and held out as they cross. A cloth of 18×12 quads moved
 * on the CPU: cheaper than a shader and easy to reason about.
 */
function ChequeredFlag() {
  const finalLap = useGameStore((state) => state.finalLap);
  const phase = useGameStore((state) => state.phase);
  const active = finalLap || phase === 'finished';
  const geometry = useMemo(() => new PlaneGeometry(1.5, 1.0, 18, 12), []);
  const chequer = useChequerTexture();
  const flag = useRef<Mesh>(null);
  const time = useRef(0);
  const anchor = useMemo(() => {
    const { point, tangent } = projectedTrack.at(0.0, -9.6);
    return { point, heading: Math.atan2(tangent.z, tangent.x) };
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    const mesh = flag.current;
    if (!mesh || !active) return;
    time.current += delta;
    const positions = geometry.attributes.position;
    const wave = phase === 'finished' ? 0.9 : 1.6;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      // The flag is pinned along its left edge (x = -0.75) and free at the tip.
      const free = (x + 0.75) / 1.5;
      positions.setZ(index, Math.sin(x * 6 + time.current * 9 * wave) * 0.08 * free + Math.sin(y * 5 + time.current * 6) * 0.03 * free);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    // A marshal waving: the whole flag swings on the pole.
    mesh.rotation.z = Math.sin(time.current * 5 * wave) * 0.35 * (phase === 'finished' ? 0.5 : 1);
  });

  if (!active) return null;
  return (
    <group position={[anchor.point.x, anchor.point.y, anchor.point.z]} rotation={[0, -anchor.heading, 0]}>
      <mesh position={[0, 1.4, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 2.8, 8]} />
        <meshStandardMaterial color="#d9d9d9" roughness={0.4} metalness={0.6} />
      </mesh>
      <group position={[0, 2.5, 0]}>
        <mesh ref={flag} geometry={geometry} position={[0.75, 0, 0]} castShadow>
          <meshStandardMaterial map={chequer} side={2} roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

/** Development only: exposes the scene and camera for inspection from the console. */
function DevExpose() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    Object.assign(window as unknown as Record<string, unknown>, { __apex: { scene, camera, gl } });
  }, [scene, camera, gl]);
  return null;
}

/** Where the shadow frustum should sit: on the player's car. */
function playerFocus() {
  const { car, surfaceY } = gameStore.getState();
  return { x: car.x, y: surfaceY, z: car.z };
}

export function GameScene({ muted, lite = false, onWarm }: { muted: boolean; lite?: boolean; onWarm: () => void }) {
  // Render resolution follows the frame rate: it starts at native and climbs
  // only when frames have headroom. The start, with the whole field in view,
  // is the heaviest moment of the race, so it is never also the sharpest.
  // Phones stay at 1 with no shadows: they have the pixels but not the GPU.
  const [dpr, setDpr] = useState(1);
  return (
    <Canvas
      className="race-canvas"
      shadows={!lite}
      dpr={dpr}
      // A logarithmic depth buffer: the chase camera looks along the road at a
      // grazing angle, and with a 9 km far plane the painted lines and kerbs
      // would otherwise fight the tarmac for depth and flicker.
      camera={{ position: [-120, 8, 380], fov: 62, near: 1, far: 9000 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true }}
    >
      <PerformanceMonitor
        onDecline={() => setDpr((current) => Math.max(0.75, current - 0.25))}
        onIncline={() => setDpr((current) => Math.min(lite ? 1.25 : 1.5, current + 0.25))}
        flipflops={3}
        onFallback={() => setDpr(1)}
      />
      <RaceWorld quality={lite ? 'mobile' : 'high'} shadowFocus={playerFocus} lights={litStartLights} />
      <GuideLine />
      <CarFillLights />
      <AiField />
      <PlayerCar />
      <CarEffects lite={lite} />
      <ChequeredFlag />
      <RaceReady onReady={onWarm} />
      <DevExpose />
      <ChaseCamera />
      <GameLoop muted={muted} />
    </Canvas>
  );
}
