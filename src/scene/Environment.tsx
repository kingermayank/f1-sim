import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  DirectionalLight,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
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
 * Geometry the circuit should not show: the source game's AI-line helper (a
 * solid black ribbon lying exactly on the tarmac, which flickers against it)
 * and the sponsor cubes it scattered along the grid and barriers.
 */
const HIDDEN_TRACK_MATERIALS = new Set(['raceline', 'wall8']);

/**
 * The model's road is three layers that the source game composited with its
 * own shaders: a 64-pixel streaky asphalt tile (`tarmac`), a white-line strip
 * on black laid over the whole road (`Line_asf`), and run-off asphalt whose
 * texture coordinates span thousands of repeats (`Out`). Drawn plainly, the
 * black of the line strip and the smeared run-off read as blotches. Each is
 * rebuilt here: the lines become an alpha-masked decal, the tarmac gets a
 * generated fine grain at a two-metre tile, and the run-off a plain surface.
 */
const ROAD_TARMAC_MATERIAL = 'tarmac';
const ROAD_LINE_MATERIAL = 'Line_asf';
const ROAD_RUNOFF_MATERIAL = 'Out';
/** The tarmac mesh's UVs repeat about every 1.1 m along the road and 0.5 m across it. */
const TARMAC_UV_METRES = { along: 1.1, across: 0.5 };
const TARMAC_TILE_METRES = 2;

/**
 * Meshes whose triangle winding must agree with their vertex normals. About
 * 8% of the tarmac's triangles in the supplied model are wound the other way;
 * on a double-sided material three.js flips the normal for a back-facing
 * triangle, so those patches are lit from below and render black.
 */
const WINDING_FIX_MATERIALS = new Set(['tarmac', 'Line_asf', 'Out', 'Prato', '9!0', '22', '13', '28', 'Kerb_giallo', 'skid', 'sha_gridlines_a']);

/** Re-winds any triangle whose geometric normal opposes its vertex normal. */
function alignWindingToNormals(mesh: Mesh): number {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  if (!position || !normal || !index) return 0;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  let fixed = 0;
  for (let face = 0; face < index.count; face += 3) {
    const ia = index.getX(face);
    const ib = index.getX(face + 1);
    const ic = index.getX(face + 2);
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib).sub(a);
    c.fromBufferAttribute(position, ic).sub(a);
    b.cross(c);
    n.fromBufferAttribute(normal, ia);
    if (b.dot(n) < 0) {
      index.setX(face + 1, ic);
      index.setX(face + 2, ib);
      fixed += 1;
    }
  }
  if (fixed > 0) index.needsUpdate = true;
  return fixed;
}

/** Fine asphalt grain: a base grey, coarse 32 px cells, per-pixel noise, and sparse light chips. Tiles seamlessly. */
function createAsphaltTexture(size = 512): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(size, size);
  const cells = size / 32;
  const cell = Array.from({ length: cells * cells }, () => (Math.random() - 0.5) * 8);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const coarse = cell[Math.floor(y / 32) * cells + Math.floor(x / 32)];
      const fine = (Math.random() - 0.5) * 18;
      const chip = Math.random() < 0.002 ? 28 : 0;
      const value = Math.max(0, Math.min(255, 56 + coarse + fine + chip));
      const offset = (y * size + x) * 4;
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = value + 2;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Paint and rubber that sit on the road surface at the same height as the
 * tarmac beneath them: the lined asphalt layer, skid marks, kerb paint, grid
 * boxes and pit lines. Drawn with a small depth offset so they always land on
 * top instead of fighting the tarmac pixel by pixel.
 */
const ROAD_DECAL_MATERIALS = new Set(['Line_asf', 'skid', 'Kerb_giallo', 'sha_gridlines_a', 'LInea_PITNew', 'Pit_lane']);

/**
 * The supplied Shanghai circuit, and the visible road surface. The centerline
 * that drives the simulation was fitted to this same mesh, so the racing line
 * and the rendered tarmac cannot drift apart.
 */
function LoadedTrack() {
  const gltf = useGLTF(ASSETS.track);
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy());
  const asphalt = useMemo(() => {
    const texture = createAsphaltTexture();
    texture.repeat.set(TARMAC_UV_METRES.along / TARMAC_TILE_METRES, TARMAC_UV_METRES.across / TARMAC_TILE_METRES);
    texture.anisotropy = maxAnisotropy;
    return texture;
  }, [maxAnisotropy]);
  useEffect(() => () => asphalt.dispose(), [asphalt]);

  const resources = useMemo(() => cloneSceneWithOwnedMaterials(gltf.scene, (material) => {
    if (!(material instanceof MeshStandardMaterial)) return;
    material.roughness = Math.max(0.55, material.roughness);
    if (ROAD_DECAL_MATERIALS.has(material.name)) {
      material.polygonOffset = true;
      material.polygonOffsetFactor = -1;
      material.polygonOffsetUnits = -2;
    }
    if (material.name === ROAD_TARMAC_MATERIAL) {
      material.map = asphalt;
      material.color.set('#ffffff');
      material.roughness = 0.93;
      material.metalness = 0;
      material.needsUpdate = true;
    } else if (material.name === ROAD_LINE_MATERIAL && material.map) {
      // White where the strip is white, nothing where it is black.
      material.map.anisotropy = maxAnisotropy;
      material.alphaMap = material.map;
      material.map = null;
      material.color.set('#f2f2ee');
      material.alphaTest = 0.5;
      material.roughness = 0.7;
      material.needsUpdate = true;
    } else if (material.name === ROAD_RUNOFF_MATERIAL) {
      material.map = null;
      material.color.set('#3f4042');
      material.roughness = 0.95;
      material.needsUpdate = true;
    } else if (material.map) {
      material.map.anisotropy = Math.min(4, maxAnisotropy);
    }
  }), [gltf.scene, asphalt, maxAnisotropy]);
  useEffect(() => () => resources.dispose(), [resources]);
  useEffect(() => {
    resources.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.receiveShadow = true;
      // The circuit receives car shadows; making 820k triangles cast them costs
      // far more than it adds.
      object.castShadow = false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => HIDDEN_TRACK_MATERIALS.has(material.name))) object.visible = false;
      if (materials.some((material) => WINDING_FIX_MATERIALS.has(material.name))) alignWindingToNormals(object);
      if (materials.some((material) => ROAD_DECAL_MATERIALS.has(material.name))) object.renderOrder = 1;
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
      <meshBasicMaterial color="#dbff4a" transparent opacity={0.15} depthWrite={false} />
    </mesh>
  );
}

export interface ShadowFocus {
  x: number;
  y: number;
  z: number;
}

const SUN_DIRECTION = new Vector3(620, 780, 420).normalize();
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

export function Environment({ quality, shadowFocus, racingLine = true }: { quality: SceneQualityTier; shadowFocus?: () => ShadowFocus; racingLine?: boolean }) {
  return (
    <>
      <color attach="background" args={['#8fb2c4']} />
      <fog attach="fog" args={['#9db9c8', 900, 3400]} />
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
      {/* Sits below the circuit datum so the supplied terrain reads as the
          surface and this only fills the far horizon. */}
      <mesh position={[0, -8, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[CIRCUIT_EXTENT * 4, CIRCUIT_EXTENT * 4, 1, 1]} />
        <meshStandardMaterial color="#5d6a54" roughness={1} />
      </mesh>
      {racingLine && <RacingLineOverlay quality={quality} />}
      <TrackAssetBoundary fallback={<CircuitFallback />}>
        <Suspense fallback={null}><LoadedTrack /></Suspense>
      </TrackAssetBoundary>
    </>
  );
}
