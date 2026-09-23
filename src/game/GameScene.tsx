import { PerformanceMonitor, useProgress } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { CanvasTexture, Group, Mesh, PerspectiveCamera, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import { Environment } from '../scene/Environment';
import { SHANGHAI_TRACK } from '../track/shanghai-track';
import { createSplineTrack } from '../track/spline-track';
import { createEngineAudio } from './engine-audio';
import { INTRO_SECONDS, gameStore, projectedTrack, useGameStore } from './game-store';
import { getPlayerInput } from './input';
import { GuideLine } from './GuideLine';
import { TeamCarModel } from './TeamCarModel';

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
    // The intro waits for the loading screen: assets in, shaders compiled,
    // and the player ready. Everything after it is already warm.
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
      <Suspense fallback={null}><TeamCarModel teamId={teamId} alwaysVisible /></Suspense>
    </group>
  );
}

/** Beyond this distance from the player a rival draws its low-detail model; back inside the nearer one, the full model. */
const LOD_FAR_METRES = 48;
const LOD_NEAR_METRES = 36;
/** Only rivals this close cast shadows: the rest would render into the shadow map for nothing visible. */
const SHADOW_METRES = 40;

/**
 * One AI car on the spline. Position is read imperatively each frame. Both
 * detail levels are mounted and toggled by distance with hysteresis, so a
 * swap never waits on a load and never flickers at the boundary.
 */
function AiCar({ driverId, teamId }: { driverId: string; teamId: string }) {
  const group = useRef<Group>(null);
  const full = useRef<Group>(null);
  const low = useRef<Group>(null);
  const usingLow = useRef(true);
  useFrame(() => {
    const object = group.current;
    if (!object) return;
    const state = gameStore.getState();
    const car = state.ai.find((candidate) => candidate.driverId === driverId);
    if (!car) return;
    const distance = Math.hypot(object.position.x - state.car.x, object.position.z - state.car.z);
    if (usingLow.current && distance < LOD_NEAR_METRES) usingLow.current = false;
    else if (!usingLow.current && distance > LOD_FAR_METRES) usingLow.current = true;
    if (full.current) full.current.visible = !usingLow.current;
    if (low.current) low.current.visible = usingLow.current;
    const casts = distance < SHADOW_METRES;
    const active = usingLow.current ? low.current : full.current;
    if (active && active.userData.casts !== casts) {
      active.userData.casts = casts;
      active.traverse((child) => { if (child instanceof Mesh) child.castShadow = casts; });
    }
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
      <group ref={full} visible={false}><Suspense fallback={null}><TeamCarModel teamId={teamId} /></Suspense></group>
      <group ref={low}><Suspense fallback={null}><TeamCarModel teamId={teamId} detail="low" /></Suspense></group>
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
    const back = 7.5 + speedFraction * 5.5;
    const up = 2.8 + speedFraction * 1.4;
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
        point(a, -70, 60, 42);
        point(b, 30, 34, 26);
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
        b.copy(carPosition).addScaledVector(heading, -9).addScaledVector(up, 3.2);
        position.lerpVectors(a, b, t);
        look.copy(carPosition).addScaledVector(heading, 12 * t).addScaledVector(up, 1.2);
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

/**
 * Compiles every shader the race will need before the first frame is shown.
 * Without this the first seconds of the race — the busiest — also pay for
 * thirty-odd program compilations, one hitch each.
 */
function WarmUp({ onWarm }: { onWarm: () => void }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const loading = useProgress((state) => state.active);
  const warmed = useRef(false);
  useEffect(() => {
    if (loading || warmed.current) return;
    warmed.current = true;
    const compile = (gl as unknown as { compileAsync?: (scene: unknown, camera: unknown) => Promise<unknown> }).compileAsync;
    const done = compile ? compile.call(gl, scene, camera) : Promise.resolve(gl.compile(scene, camera));
    void done.catch(() => undefined).then(onWarm);
  }, [loading, gl, scene, camera, onWarm]);
  return null;
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
      <Environment quality={lite ? 'mobile' : 'high'} shadowFocus={playerFocus} racingLine={false} />
      <GuideLine />
      <AiField />
      <PlayerCar />
      <ChequeredFlag />
      <WarmUp onWarm={onWarm} />
      <DevExpose />
      <ChaseCamera />
      <GameLoop muted={muted} />
    </Canvas>
  );
}
