import { useGLTF } from '@react-three/drei';
import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  TubeGeometry,
  Vector3,
} from 'three';
import { ASSETS } from '../assets/asset-registry';
import { SHANGHAI_TRACK } from '../track/shanghai-track';
import type { TrackPoint } from '../track/track-types';
import type { SceneQualityTier } from './RaceScene';
import { cloneSceneWithOwnedMaterials } from './scene-resources';

/**
 * Shanghai is authored in real metres and the supplied model spans roughly
 * 3.4 km including surrounding terrain, so lighting, fog and ground geometry are
 * sized to the real circuit rather than to the previous stylised layout.
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
 * The supplied Shanghai circuit, and the visible road surface. The centerline
 * that drives the simulation was fitted to this same mesh, so the racing line
 * and the rendered tarmac cannot drift apart.
 */
function LoadedTrack() {
  const gltf = useGLTF(ASSETS.track);
  const resources = useMemo(() => cloneSceneWithOwnedMaterials(gltf.scene, (material) => {
    if (material instanceof MeshStandardMaterial) {
      material.roughness = Math.max(0.62, material.roughness);
      if (material.color.r < 0.3 && material.color.g < 0.3 && material.color.b < 0.3) {
        material.color.multiplyScalar(0.7);
      }
    }
  }), [gltf.scene]);
  useEffect(() => () => resources.dispose(), [resources]);
  useEffect(() => {
    resources.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.receiveShadow = true;
      // The circuit receives car shadows; making 820k triangles cast them costs
      // far more than it adds.
      object.castShadow = false;
    });
  }, [resources]);

  return <primitive object={resources.scene} dispose={null} />;
}

/**
 * Legal procedural fallback, rendered only when the supplied circuit fails to
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
        <meshStandardMaterial color="#0f1418" roughness={0.92} metalness={0.02} />
      </mesh>
      <mesh geometry={pitGeometry} receiveShadow>
        <meshStandardMaterial color="#1a2024" roughness={0.94} />
      </mesh>
      <mesh geometry={outerBarrier} castShadow receiveShadow>
        <meshStandardMaterial color="#d8dce0" roughness={0.78} />
      </mesh>
      <mesh geometry={innerBarrier} castShadow receiveShadow>
        <meshStandardMaterial color="#a82828" roughness={0.82} />
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
      <meshBasicMaterial color="#b4c8dc" transparent opacity={0.08} depthWrite={false} />
    </mesh>
  );
}

export function Environment({ quality }: { quality: SceneQualityTier }) {
  return (
    <>
      <color attach="background" args={['#4a5d70']} />
      <fog attach="fog" args={['#3d4f5f', 1200, 3600]} />
      <hemisphereLight args={['#a8c4dc', '#1a2228', quality === 'high' ? 1.2 : 1.5]} />
      <directionalLight
        castShadow={quality === 'high'}
        color="#d8e8f8"
        intensity={2.8}
        position={[720, 880, 520]}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-CIRCUIT_EXTENT / 2}
        shadow-camera-right={CIRCUIT_EXTENT / 2}
        shadow-camera-top={CIRCUIT_EXTENT / 2}
        shadow-camera-bottom={-CIRCUIT_EXTENT / 2}
        shadow-camera-far={2600}
        shadow-bias={-0.0006}
      />
      <ambientLight intensity={0.3} color="#b4c8dc" />
      {/* Sits below the circuit datum so the supplied terrain reads as the
          surface and this only fills the far horizon. */}
      <mesh position={[0, -8, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[CIRCUIT_EXTENT * 4, CIRCUIT_EXTENT * 4, 1, 1]} />
        <meshStandardMaterial color="#3a4a54" roughness={1} />
      </mesh>
      <RacingLineOverlay quality={quality} />
      <TrackAssetBoundary fallback={<CircuitFallback />}>
        <Suspense fallback={null}><LoadedTrack /></Suspense>
      </TrackAssetBoundary>
    </>
  );
}
