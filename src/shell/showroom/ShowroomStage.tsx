import { Environment, Lightformer, MeshReflectorMaterial } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react';
import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  Group,
  Mesh,
  RepeatWrapping,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
} from 'three';
import { SHANGHAI_TRACK } from '../../track/shanghai-track';
import { CAR_DIMENSIONS } from '../../car/car-geometry';

/**
 * The room the car is shown in: a dark tiled floor, a polished turntable
 * that carries the car round, a curved wall ringed with warm LED strips, a
 * neon trace of the circuit you are about to race lapping on the back wall,
 * and a ceiling softbox. The environment map mirrors the same layout as
 * long light strips, which is what makes car paint read.
 */

export const TURNTABLE_RADIUS = 3.25;
const ROOM_RADIUS = 13;
const ROOM_HEIGHT = 7.4;
/** Radians per second: one turn in about 39 s. */
export const TURNTABLE_SPEED = 0.16;

function canvasTexture(size: number, draw: (context: CanvasRenderingContext2D, size: number) => void, srgb = true): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  draw(context, size);
  const texture = new CanvasTexture(canvas);
  if (srgb) texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Large blue-grey stone tiles with faint smudges and dark grout. */
function floorTexture(): CanvasTexture {
  const texture = canvasTexture(1024, (context, size) => {
    const tiles = 4;
    const cell = size / tiles;
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let row = 0; row < tiles; row += 1) {
      for (let column = 0; column < tiles; column += 1) {
        const hue = 215 + random() * 8;
        const sat = 8 + random() * 4;
        const light = 12.5 + random() * 3;
        context.fillStyle = `hsl(${hue} ${sat}% ${light}%)`;
        context.fillRect(column * cell, row * cell, cell, cell);
        for (let smudge = 0; smudge < 70; smudge += 1) {
          context.fillStyle = `hsla(${hue} ${sat}% ${light + (random() - 0.5) * 6}% / ${0.05 + random() * 0.08})`;
          context.beginPath();
          context.ellipse(column * cell + random() * cell, row * cell + random() * cell, 6 + random() * 40, 3 + random() * 18, random() * Math.PI, 0, Math.PI * 2);
          context.fill();
        }
      }
    }
    context.fillStyle = '#07090c';
    for (let line = 0; line <= tiles; line += 1) {
      context.fillRect(line * cell - 2, 0, 4, size);
      context.fillRect(0, line * cell - 2, size, 4);
    }
  });
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(26 / 6.4, 26 / 6.4);
  texture.anisotropy = 8;
  return texture;
}

/** Fine concentric brushing for the turntable's roughness. */
function brushedTexture(): CanvasTexture {
  return canvasTexture(1024, (context, size) => {
    context.fillStyle = '#8a8a8a';
    context.fillRect(0, 0, size, size);
    let seed = 3;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let radius = 4; radius < size / 2; radius += 2.2) {
      const grey = 118 + Math.round((random() - 0.5) * 34);
      context.strokeStyle = `rgba(${grey}, ${grey}, ${grey}, 0.55)`;
      context.lineWidth = 1.2;
      const start = random() * Math.PI * 2;
      context.beginPath();
      context.arc(size / 2, size / 2, radius, start, start + Math.PI * (1 + random()));
      context.stroke();
    }
  }, false);
}

/** A soft radial falloff, for blob shadows. */
function radialTexture(inner: number): CanvasTexture {
  return canvasTexture(256, (context, size) => {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(inner, 'rgba(0,0,0,0.55)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }, false);
}

/** A thin glowing ring: a Gaussian across radius `at` (fraction of the half size), `width` wide. */
function ringTexture(at: number, width: number): CanvasTexture {
  return canvasTexture(1024, (context, size) => {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (let step = -3; step <= 3; step += 0.5) {
      const stop = at + step * width;
      if (stop <= 0 || stop >= 1) continue;
      gradient.addColorStop(stop, `rgba(255,255,255,${Math.exp(-(step * step) / 2).toFixed(3)})`);
    }
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }, false);
}

function useDisposable<T extends { dispose(): void }>(factory: () => T, deps: unknown[] = []): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(factory, deps);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

/** Long light strips and a softbox, baked once into the reflections. */
export function StudioReflections({ accent }: { accent: string }) {
  return (
    <Environment resolution={512} frames={1} environmentIntensity={1}>
      <color attach="background" args={['#0b0f17']} />
      <Lightformer form="rect" intensity={3.5} color="#ffffff" position={[0, 12, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[14, 7, 1]} />
      <Lightformer form="rect" intensity={2.6} color="#ffd6a3" position={[0, 3.2, -12]} scale={[26, 1, 1]} />
      <Lightformer form="rect" intensity={2.6} color="#ffd6a3" position={[0, 3.2, 12]} rotation={[0, Math.PI, 0]} scale={[26, 1, 1]} />
      <Lightformer form="rect" intensity={2.2} color="#a9d6ff" position={[-14, 3, 0]} rotation={[0, Math.PI / 2, 0]} scale={[26, 1, 1]} />
      <Lightformer form="rect" intensity={1.4} color={accent} position={[14, 1.6, 0]} rotation={[0, -Math.PI / 2, 0]} scale={[20, 0.6, 1]} />
      <Lightformer form="rect" intensity={0.8} color="#ffffff" position={[0, 1.2, 14]} rotation={[0, Math.PI, 0]} scale={[10, 2.5, 1]} />
    </Environment>
  );
}

function StudioLights() {
  return (
    <>
      <hemisphereLight args={['#9fb4e0', '#2a241e', 0.32]} />
      <directionalLight
        color="#fff2e2"
        intensity={1.6}
        position={[0.12 * 14, 14, 0.2 * 14]}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-4.6}
        shadow-camera-right={4.6}
        shadow-camera-top={4.6}
        shadow-camera-bottom={-4.6}
        shadow-camera-near={2}
        shadow-camera-far={30}
        shadow-normalBias={0.012}
        shadow-bias={-0.0003}
        shadow-radius={3}
      />
      <directionalLight color="#8fd8ff" intensity={1.1} position={[-6, 7, -9]} />
      <directionalLight color="#ffe6cc" intensity={0.32} position={[8, 5, 9]} />
    </>
  );
}

/** The circuit as a glowing ribbon on the back wall, with a light lapping it. */
function NeonCircuit({ accent }: { accent: string }) {
  const { curve, geometry } = useMemo(() => {
    const points = SHANGHAI_TRACK.centerLine;
    const xs = points.map((point) => point.x);
    const zs = points.map((point) => point.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const span = Math.max(maxX - minX, maxZ - minZ);
    const width = 4.4;
    const step = Math.max(1, Math.floor(points.length / 220));
    const flat = points
      .filter((_, index) => index % step === 0)
      .map((point) => new Vector3(((point.x - (minX + maxX) / 2) / span) * width, -((point.z - (minZ + maxZ) / 2) / span) * width, 0));
    const path = new CatmullRomCurve3(flat, true, 'centripetal');
    return { curve: path, geometry: new TubeGeometry(path, 600, 0.028, 6, true) };
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const runner = useRef<Mesh>(null);
  const trail = useRef<Mesh[]>([]);
  const clock = useRef(0);
  const glow = useMemo(() => new Color(accent).multiplyScalar(2.2), [accent]);
  useFrame((_, delta) => {
    clock.current = (clock.current + Math.min(delta, 0.1) / 40) % 1;
    const at = curve.getPointAt(clock.current);
    runner.current?.position.copy(at);
    trail.current.forEach((mesh, index) => {
      if (mesh) mesh.position.copy(curve.getPointAt((clock.current - (index + 1) * 0.004 + 1) % 1));
    });
  });
  // On the wall behind the car as the hero camera sees it, a little to the left.
  const angle = Math.atan2(-Math.cos(0.78), -Math.sin(0.78)) - 0.32;
  const distance = ROOM_RADIUS - 0.25;
  return (
    <group position={[Math.cos(angle) * distance, 2.55, Math.sin(angle) * distance]} rotation={[0, -angle - Math.PI / 2, 0]}>
      <mesh geometry={geometry}>
        <meshBasicMaterial color={new Color('#cfeeff').multiplyScalar(0.55)} toneMapped={false} />
      </mesh>
      <mesh ref={runner}>
        <sphereGeometry args={[0.09, 16, 12]} />
        <meshBasicMaterial color={glow} toneMapped={false} />
      </mesh>
      {Array.from({ length: 8 }, (_, index) => (
        <mesh key={index} ref={(node) => { if (node) trail.current[index] = node; }}>
          <sphereGeometry args={[0.07 * (1 - index / 10), 10, 8]} />
          <meshBasicMaterial color={glow} transparent opacity={0.6 * (1 - index / 8)} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function Room({ accent }: { accent: string }) {
  const floor = useDisposable(floorTexture);
  const strips = useMemo(() => Array.from({ length: 10 }, (_, index) => ((index + 0.5) / 10) * Math.PI * 2), []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
        <circleGeometry args={[ROOM_RADIUS + 0.5, 96]} />
        <meshStandardMaterial map={floor} roughness={0.26} metalness={0.1} envMapIntensity={0.22} />
      </mesh>
      <mesh position={[0, ROOM_HEIGHT / 2, 0]}>
        <cylinderGeometry args={[ROOM_RADIUS, ROOM_RADIUS, ROOM_HEIGHT, 96, 1, true]} />
        <meshStandardMaterial color="#1c2330" roughness={0.62} metalness={0.15} side={BackSide} />
      </mesh>
      <mesh position={[0, ROOM_HEIGHT, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[ROOM_RADIUS, 64]} />
        <meshStandardMaterial color="#111620" roughness={0.8} />
      </mesh>
      {/* Ceiling softbox over the car. */}
      <mesh position={[0, ROOM_HEIGHT - 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[6.6, 3]} />
        <meshBasicMaterial color={new Color('#ffffff').multiplyScalar(2.3)} toneMapped={false} side={BackSide} />
      </mesh>
      {/* Warm LED ring under the ceiling and along the skirting. */}
      <mesh position={[0, ROOM_HEIGHT - 0.35, 0]}>
        <cylinderGeometry args={[ROOM_RADIUS - 0.05, ROOM_RADIUS - 0.05, 0.05, 96, 1, true]} />
        <meshBasicMaterial color={new Color('#ffb86b').multiplyScalar(3)} toneMapped={false} side={BackSide} />
      </mesh>
      <mesh position={[0, 0.16, 0]}>
        <cylinderGeometry args={[ROOM_RADIUS - 0.05, ROOM_RADIUS - 0.05, 0.03, 96, 1, true]} />
        <meshBasicMaterial color={new Color('#ffae5c').multiplyScalar(1.8)} toneMapped={false} side={BackSide} />
      </mesh>
      {/* Vertical LED strips round the wall, between dark mullions. */}
      {strips.map((angle) => (
        <mesh key={angle} position={[Math.cos(angle) * (ROOM_RADIUS - 0.06), 2.9, Math.sin(angle) * (ROOM_RADIUS - 0.06)]} rotation={[0, -angle, 0]}>
          <boxGeometry args={[0.03, 5.6, 0.05]} />
          <meshBasicMaterial color={new Color('#ffb468').multiplyScalar(1.5)} toneMapped={false} />
        </mesh>
      ))}
      <NeonCircuit accent={accent} />
    </group>
  );
}

/**
 * The turntable and everything that turns with it. Children (the car) sit on
 * its top surface. It turns slowly unless `spinning` is off, and eases back to
 * its hero heading when stopped.
 */
export function Turntable({ accent, spinning, reflect, children, groupRef }: { accent: string; spinning: boolean; reflect: boolean; children: ReactNode; groupRef?: MutableRefObject<Group | null> }) {
  const group = useRef<Group>(null);
  const brushed = useDisposable(brushedTexture);
  const blob = useDisposable(() => radialTexture(0.45));
  const tyreBlob = useDisposable(() => radialTexture(0.3));
  const outerRing = useDisposable(() => ringTexture((TURNTABLE_RADIUS + 0.035) / (TURNTABLE_RADIUS + 0.3), 0.009));
  const innerRingTexture = useDisposable(() => ringTexture((TURNTABLE_RADIUS - 0.29) / TURNTABLE_RADIUS, 0.006));
  const spin = useRef(spinning ? 1 : 0);
  const angle = useRef(0);
  const ringColour = useMemo(() => new Color(accent).multiplyScalar(1.35), [accent]);
  const innerRing = useMemo(() => new Color('#cfe8ff').multiplyScalar(1.1), []);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    spin.current += ((spinning ? 1 : 0) - spin.current) * (1 - Math.exp(-2 * delta));
    if (spinning || spin.current > 0.02) {
      angle.current += TURNTABLE_SPEED * spin.current * delta;
    } else {
      // Ease back to the nearest whole turn: the hero heading.
      const home = Math.round(angle.current / (Math.PI * 2)) * Math.PI * 2;
      angle.current += (home - angle.current) * (1 - Math.exp(-2.5 * delta));
    }
    if (group.current) group.current.rotation.y = angle.current;
  });

  const tyreShadows = [
    [CAR_DIMENSIONS.frontTrack, CAR_DIMENSIONS.frontAxleZ, CAR_DIMENSIONS.frontTyreHalfWidth],
    [-CAR_DIMENSIONS.frontTrack, CAR_DIMENSIONS.frontAxleZ, CAR_DIMENSIONS.frontTyreHalfWidth],
    [CAR_DIMENSIONS.rearTrack, CAR_DIMENSIONS.rearAxleZ, CAR_DIMENSIONS.rearTyreHalfWidth],
    [-CAR_DIMENSIONS.rearTrack, CAR_DIMENSIONS.rearAxleZ, CAR_DIMENSIONS.rearTyreHalfWidth],
  ];

  return (
    <>
      {/* The fixed dark-metal surround and its glowing gap ring. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} receiveShadow>
        <ringGeometry args={[TURNTABLE_RADIUS + 0.06, TURNTABLE_RADIUS + 0.42, 128]} />
        <meshStandardMaterial color="#14171c" roughness={0.35} metalness={0.8} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}>
        <planeGeometry args={[(TURNTABLE_RADIUS + 0.3) * 2, (TURNTABLE_RADIUS + 0.3) * 2]} />
        <meshBasicMaterial map={outerRing} color={ringColour} transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={(node) => { group.current = node; if (groupRef) groupRef.current = node; }}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} receiveShadow>
          <circleGeometry args={[TURNTABLE_RADIUS, 128]} />
          {!reflect ? (
            <meshPhysicalMaterial color="#23272e" roughness={0.4} metalness={0.5} clearcoat={0.35} clearcoatRoughness={0.3} roughnessMap={brushed} envMapIntensity={0.4} />
          ) : (
            <MeshReflectorMaterial
              color="#1a1e25"
              roughness={0.5}
              metalness={0.55}
              roughnessMap={brushed}
              blur={[420, 140]}
              resolution={1024}
              mixBlur={1}
              mixStrength={0.95}
              mixContrast={1}
              depthScale={0.6}
              minDepthThreshold={0.3}
              maxDepthThreshold={1.4}
              mirror={0.6}
              envMapIntensity={0.22}
            />
          )}
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0065, 0]}>
          <planeGeometry args={[TURNTABLE_RADIUS * 2, TURNTABLE_RADIUS * 2]} />
          <meshBasicMaterial map={innerRingTexture} color={innerRing} transparent opacity={0.55} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.007, 0]}>
          <planeGeometry args={[2.4, 5.6]} />
          <meshBasicMaterial map={blob} transparent opacity={0.5} depthWrite={false} />
        </mesh>
        {tyreShadows.map(([x, z, halfWidth]) => (
          <mesh key={`${x}:${z}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.0075, z]}>
            <planeGeometry args={[halfWidth * 2 + 0.34, 0.78]} />
            <meshBasicMaterial map={tyreBlob} transparent opacity={0.8} depthWrite={false} />
          </mesh>
        ))}
        <group position={[0, 0.006, 0]}>{children}</group>
      </group>
    </>
  );
}

export function ShowroomStage({ accent }: { accent: string }) {
  return (
    <>
      <color attach="background" args={['#0c111b']} />
      <fogExp2 attach="fog" args={['#141b28', 0.011]} />
      {/* Re-baked when the team changes, so the accent strip in the paint follows it. */}
      <StudioReflections key={accent} accent={accent} />
      <StudioLights />
      <Room accent={accent} />
    </>
  );
}
