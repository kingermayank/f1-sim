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
import { MONACO_TRACK } from '../track/monaco-track';
import { createSplineTrack } from '../track/spline-track';
import type { TrackPoint } from '../track/track-types';
import type { SceneQualityTier } from './RaceScene';
import { cloneSceneWithOwnedMaterials } from './scene-resources';

const TRACK = createSplineTrack(MONACO_TRACK);

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

function LoadedTrack() {
  const gltf = useGLTF(ASSETS.track);
  const resources = useMemo(() => cloneSceneWithOwnedMaterials(gltf.scene, (material) => {
    if (material instanceof MeshStandardMaterial) material.roughness = Math.max(0.55, material.roughness);
  }), [gltf.scene]);
  useEffect(() => () => resources.dispose(), [resources]);
  useEffect(() => {
    resources.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.receiveShadow = true;
      object.castShadow = true;
    });
  }, [resources]);

  return <primitive object={resources.scene} dispose={null} scale={2.3} position={[-9, -2.5, -19]} rotation={[0, -0.08, 0]} />;
}

class TrackAssetBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

const CITY_BLOCKS = [
  [-80, -59, 10, 14, 11], [-72, -78, 12, 20, 14], [-51, -101, 14, 23, 13],
  [-25, -111, 12, 18, 11], [4, -110, 16, 28, 14], [32, -101, 13, 22, 11],
  [64, -78, 14, 26, 14], [73, -49, 12, 20, 10], [72, -21, 13, 17, 13],
  [68, 17, 15, 21, 14], [48, 54, 12, 19, 12], [22, 65, 13, 16, 11],
  [-10, 69, 14, 23, 13], [-43, 66, 16, 28, 14], [-69, 49, 13, 20, 12],
  [-91, 24, 14, 24, 13], [-96, -7, 11, 17, 10], [-97, -35, 15, 22, 13],
] as const;

function CityAndHarbor({ quality }: { quality: SceneQualityTier }) {
  const buildingCount = quality === 'mobile' ? 10 : CITY_BLOCKS.length;
  return (
    <group name="Monaco city and harbor cues">
      {CITY_BLOCKS.slice(0, buildingCount).map(([x, z, width, height, depth], index) => (
        <group key={`${x}-${z}`} position={[x, height / 2 - 2.2, z]} rotation={[0, (index % 3 - 1) * 0.1, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[width, height, depth]} />
            <meshStandardMaterial
              color={index % 3 === 0 ? '#e5c8a3' : index % 3 === 1 ? '#f0dfc4' : '#d7a982'}
              roughness={0.93}
            />
          </mesh>
          <mesh position={[0, height / 2 + 0.35, 0]}>
            <boxGeometry args={[width * 0.84, 0.7, depth * 0.82]} />
            <meshStandardMaterial color={index % 2 ? '#ad725d' : '#c58a67'} roughness={0.9} />
          </mesh>
          {quality === 'high' && (
            <mesh position={[0, 0.8, depth / 2 + 0.02]}>
              <planeGeometry args={[width * 0.7, Math.max(2, height * 0.5)]} />
              <meshBasicMaterial color="#f6d797" transparent opacity={0.14} />
            </mesh>
          )}
        </group>
      ))}
      {[-22, -12, 0, 11, 22, 32].map((x, index) => (
        <group key={x} position={[x, -1.45, 18 + (index % 2) * 10]} rotation={[0, -0.35 + index * 0.08, 0]}>
          <mesh castShadow>
            <boxGeometry args={[2.2, 0.6, 8 + (index % 3) * 2]} />
            <meshStandardMaterial color="#f3eee2" roughness={0.6} metalness={0.08} />
          </mesh>
          <mesh position={[0, 1, 0.7]}>
            <boxGeometry args={[1.1, 1.6, 3.2]} />
            <meshStandardMaterial color="#e1d5c0" roughness={0.75} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function CircuitFallback() {
  const trackGeometry = useMemo(() => createRibbon(MONACO_TRACK.centerLine, 3.35), []);
  const pitGeometry = useMemo(() => createRibbon(MONACO_TRACK.pitLine, 1.65, false), []);
  const outerBarrier = useMemo(() => new TubeGeometry(
    new CatmullRomCurve3(offsetPoints(MONACO_TRACK.centerLine, 4), true, 'catmullrom', 0.5),
    128, 0.26, 4, true,
  ), []);
  const innerBarrier = useMemo(() => new TubeGeometry(
    new CatmullRomCurve3(offsetPoints(MONACO_TRACK.centerLine, -4), true, 'catmullrom', 0.5),
    128, 0.26, 4, true,
  ), []);

  return (
    <group name="authoritative procedural circuit">
      <mesh geometry={trackGeometry} receiveShadow>
        <meshStandardMaterial color="#272c30" roughness={0.96} metalness={0.02} />
      </mesh>
      <mesh geometry={pitGeometry} receiveShadow>
        <meshStandardMaterial color="#34393d" roughness={0.94} />
      </mesh>
      <mesh geometry={outerBarrier} castShadow receiveShadow>
        <meshStandardMaterial color="#f0eee7" roughness={0.72} />
      </mesh>
      <mesh geometry={innerBarrier} castShadow receiveShadow>
        <meshStandardMaterial color="#b72b2b" roughness={0.75} />
      </mesh>
      {MONACO_TRACK.centerLine.filter((_, index) => index % 4 === 0).map((_, index) => {
        const transform = TRACK.sample((index * 4) / MONACO_TRACK.centerLine.length, 0);
        return (
          <mesh key={index} position={transform.position} quaternion={transform.rotation}>
            <boxGeometry args={[0.14, 0.04, 2.3]} />
            <meshBasicMaterial color="#d7d4c9" />
          </mesh>
        );
      })}
    </group>
  );
}

function TracksideLandmarks() {
  const tunnel = TRACK.sample(0.34, 0);
  const stand = TRACK.sample(0.03, 8);
  return (
    <group>
      <group position={tunnel.position} quaternion={tunnel.rotation}>
        <mesh position={[-5.2, 2.7, 0]} castShadow><boxGeometry args={[3, 5.4, 16]} /><meshStandardMaterial color="#c5ab8c" roughness={1} /></mesh>
        <mesh position={[5.2, 2.7, 0]} castShadow><boxGeometry args={[3, 5.4, 16]} /><meshStandardMaterial color="#c5ab8c" roughness={1} /></mesh>
        <mesh position={[0, 5.35, 0]} castShadow><boxGeometry args={[13, 1.5, 16]} /><meshStandardMaterial color="#a88e72" roughness={1} /></mesh>
        <mesh position={[0, 2.6, 7.8]}><planeGeometry args={[7.6, 4.5]} /><meshBasicMaterial color="#10191b" /></mesh>
      </group>
      <group position={stand.position} quaternion={stand.rotation}>
        {[0, 1, 2, 3].map((row) => (
          <mesh key={row} position={[8 + row * 0.8, 0.4 + row * 0.55, -5]} castShadow>
            <boxGeometry args={[2, 0.65, 14]} />
            <meshStandardMaterial color={row % 2 ? '#ddd5c6' : '#17445a'} roughness={0.8} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function Environment({ quality }: { quality: SceneQualityTier }) {
  return (
    <>
      <color attach="background" args={['#77b5cb']} />
      <fog attach="fog" args={['#a8c8cf', 125, 270]} />
      <hemisphereLight args={['#e9f5ff', '#4d5846', quality === 'high' ? 1.55 : 1.8]} />
      <directionalLight
        castShadow={quality === 'high'}
        color="#ffd29a"
        intensity={3.4}
        position={[78, 112, 42]}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-115}
        shadow-camera-right={115}
        shadow-camera-top={115}
        shadow-camera-bottom={-115}
      />
      <mesh position={[0, -3, -8]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[330, 330, 1, 1]} />
        <meshPhysicalMaterial
          color="#176d86"
          roughness={quality === 'high' ? 0.24 : 0.4}
          metalness={0.15}
          clearcoat={quality === 'high' ? 0.7 : 0.15}
          clearcoatRoughness={0.25}
        />
      </mesh>
      <mesh position={[-9, -2.75, -24]} receiveShadow>
        <cylinderGeometry args={[104, 116, 1, 12]} />
        <meshStandardMaterial color="#987c59" roughness={1} />
      </mesh>
      <CircuitFallback />
      <TracksideLandmarks />
      <CityAndHarbor quality={quality} />
      <TrackAssetBoundary>
        <Suspense fallback={null}><LoadedTrack /></Suspense>
      </TrackAssetBoundary>
    </>
  );
}
