import { useFrame } from '@react-three/fiber';
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  BufferGeometry,
  CatmullRomCurve3,
  DirectionalLight,
  Float32BufferAttribute,
  TubeGeometry,
  Vector3,
} from 'three';
import { SHANGHAI_TRACK } from '../track/shanghai-track';
import type { TrackPoint } from '../track/track-types';
import { ApexCircuit } from './ApexCircuit';
import { CircuitSky, HORIZON_HAZE } from './CircuitSky';
import type { SceneQualityTier } from './RaceScene';

/**
 * Shanghai is authored in real metres and the circuit spans about 2 km with
 * its surroundings, so lighting and shadows are sized to the real circuit.
 */
const CIRCUIT_EXTENT = 1950;

function offsetPoints(points: readonly TrackPoint[], amount: number): Vector3[] {
  return points.map((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    return new Vector3(point.x - (dz / length) * amount, point.y + 0.15, point.z + (dx / length) * amount);
  });
}

function createRibbon(points: readonly TrackPoint[], width: number, closed = true): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const count = points.length;

  points.forEach((point, index) => {
    const previous = points[index === 0 ? (closed ? count - 1 : 0) : index - 1];
    const next = points[index === count - 1 ? (closed ? 0 : count - 1) : index + 1];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    const normalX = -dz / length;
    const normalZ = dx / length;
    positions.push(
      point.x + normalX * width, point.y + 0.08, point.z + normalZ * width,
      point.x - normalX * width, point.y + 0.08, point.z - normalZ * width,
    );
    normals.push(0, 1, 0, 0, 1, 0);
    uvs.push(index / Math.max(1, count - 1), 0, index / Math.max(1, count - 1), 1);
  });

  const segments = closed ? count : count - 1;
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % count;
    const a = index * 2;
    const b = a + 1;
    const c = next * 2;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Legal procedural fallback, rendered only when the circuit model fails to
 * load. Delivery checks assert the real asset is present, so this standing in
 * is treated as a delivery failure rather than an acceptable substitute.
 */
function CircuitFallback() {
  const trackGeometry = useMemo(() => createRibbon(SHANGHAI_TRACK.centerLine, 7.5), []);
  const pitGeometry = useMemo(() => createRibbon(SHANGHAI_TRACK.pitLine, 4, false), []);
  const outerBarrier = useMemo(() => new TubeGeometry(
    new CatmullRomCurve3(offsetPoints(SHANGHAI_TRACK.centerLine, 9), true, 'catmullrom', 0.5),
    360, 0.5, 4, true,
  ), []);
  const innerBarrier = useMemo(() => new TubeGeometry(
    new CatmullRomCurve3(offsetPoints(SHANGHAI_TRACK.centerLine, -9), true, 'catmullrom', 0.5),
    360, 0.5, 4, true,
  ), []);

  useEffect(() => () => {
    trackGeometry.dispose();
    pitGeometry.dispose();
    outerBarrier.dispose();
    innerBarrier.dispose();
  }, [trackGeometry, pitGeometry, outerBarrier, innerBarrier]);

  return (
    <group name="procedural circuit fallback">
      <mesh geometry={trackGeometry} receiveShadow>
        <meshStandardMaterial color="#171d22" roughness={0.88} metalness={0.04} />
      </mesh>
      <mesh geometry={pitGeometry} receiveShadow>
        <meshStandardMaterial color="#22292e" roughness={0.9} />
      </mesh>
      <mesh geometry={outerBarrier} castShadow receiveShadow>
        <meshStandardMaterial color="#f0eee7" roughness={0.72} />
      </mesh>
      <mesh geometry={innerBarrier} castShadow receiveShadow>
        <meshStandardMaterial color="#b72b2b" roughness={0.75} />
      </mesh>
    </group>
  );
}

class TrackAssetBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/**
 * A thin racing-line overlay drawn from the authoritative spline. It is visible
 * proof that the simulation's racing line sits on the supplied circuit's tarmac,
 * and it keeps the line readable in wide aerial shots.
 */
function RacingLineOverlay({ quality }: { quality: SceneQualityTier }) {
  const geometry = useMemo(() => createRibbon(SHANGHAI_TRACK.centerLine, 0.3), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (quality === 'mobile') return null;
  return (
    <mesh geometry={geometry} renderOrder={2}>
      <meshBasicMaterial color="#ffb82e" transparent opacity={0.15} depthWrite={false} />
    </mesh>
  );
}

export interface ShadowFocus {
  x: number;
  y: number;
  z: number;
}

export const SUN_DIRECTION = new Vector3(620, 780, 420).normalize();
/** Half-size of the shadow frustum that follows the player, metres. */
const FOLLOW_SHADOW_EXTENT = 70;

/**
 * Sun for the driving game: the same light as the broadcast scene, but its
 * shadow frustum is 140 m wide and rides along with the player instead of
 * covering the whole 2 km circuit. One shadow map over the whole circuit gives
 * a metre per texel, which at chase-camera range reads as flickering dark
 * mottling across the tarmac; here a texel is 14 cm.
 */
function FollowingSun({ focus, shadows }: { focus: () => ShadowFocus; shadows: boolean }) {
  const light = useRef<DirectionalLight>(null);
  const anchor = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const sun = light.current;
    if (!sun) return;
    const { x, y, z } = focus();
    anchor.set(x, y, z);
    sun.target.position.copy(anchor);
    sun.position.copy(anchor).addScaledVector(SUN_DIRECTION, 400);
    sun.target.updateMatrixWorld();
  });

  return (
    <directionalLight
      ref={light}
      castShadow={shadows}
      color="#ffe6c4"
      intensity={2.35}
      shadow-mapSize={[1024, 1024]}
      shadow-camera-left={-FOLLOW_SHADOW_EXTENT}
      shadow-camera-right={FOLLOW_SHADOW_EXTENT}
      shadow-camera-top={FOLLOW_SHADOW_EXTENT}
      shadow-camera-bottom={-FOLLOW_SHADOW_EXTENT}
      shadow-camera-near={100}
      shadow-camera-far={700}
      shadow-bias={-0.0002}
      shadow-normalBias={0.04}
    />
  );
}

export function Environment({ quality, shadowFocus, racingLine = true, fog = [800, 3600], lights }: {
  quality: SceneQualityTier;
  shadowFocus?: () => ShadowFocus;
  racingLine?: boolean;
  /** Where the haze begins and where it hides everything, metres. */
  fog?: readonly [number, number];
  /** How many start lights are lit, for the gantry. */
  lights?: () => number;
}) {
  return (
    <>
      <Suspense fallback={<color attach="background" args={[HORIZON_HAZE]} />}><CircuitSky /></Suspense>
      <fog attach="fog" args={[HORIZON_HAZE, fog[0], fog[1]]} />
      <hemisphereLight args={['#dceaf3', '#2b3338', quality === 'high' ? 1.05 : 1.35]} />
      {shadowFocus ? <FollowingSun focus={shadowFocus} shadows={quality === 'high'} /> : (
        <directionalLight
          castShadow={quality === 'high'}
          color="#ffe6c4"
          intensity={2.35}
          position={[620, 780, 420]}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-CIRCUIT_EXTENT / 2}
          shadow-camera-right={CIRCUIT_EXTENT / 2}
          shadow-camera-top={CIRCUIT_EXTENT / 2}
          shadow-camera-bottom={-CIRCUIT_EXTENT / 2}
          shadow-camera-far={2600}
          shadow-bias={-0.0006}
        />
      )}
      {racingLine && <RacingLineOverlay quality={quality} />}
      <TrackAssetBoundary fallback={<CircuitFallback />}>
        <Suspense fallback={null}><ApexCircuit quality={quality} lights={lights} /></Suspense>
      </TrackAssetBoundary>
    </>
  );
}
