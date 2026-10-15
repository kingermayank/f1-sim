import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Color, Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three';
import { ASSETS } from '../assets/asset-registry';
import { FIELD_SIZE, GRID_ROW_METRES, projectedTrack } from '../game/game-store';
import { computeRacingGuide } from '../game/racing-line';
import {
  createPaintMarkMaterial,
  createRoadMaterial,
  upgradeAsphalt,
  upgradeCrowd,
  upgradeFence,
  upgradeGrass,
  upgradeGravel,
} from '../game/track-materials';
import { buildGridMarks, buildTrackSurface, createSurfaceSampler, surfaceRows, type SurfaceEdges } from '../game/track-surface';
import { kerbAt } from '../track/circuit-layout';
import { SHANGHAI_TRACK } from '../track/shanghai-track';
import type { SceneQualityTier } from './RaceScene';
import { cloneSceneWithOwnedMaterials } from './scene-resources';

/**
 * The APEX Shanghai circuit, built in Blender (scripts/circuit) from the
 * centreline the cars drive on: terrain, run-off and kerbs, barriers and
 * debris fencing, grandstands with their crowds, the pit building and
 * paddock, the start gantry, bridges, signage, trees and the city skyline.
 *
 * Its materials are named for what they are, and the ones that need it are
 * replaced here with the game's own: world-space asphalt, grass and gravel
 * that continue seamlessly under the racing surface, chain-link fencing, a
 * crowd that each wear their own colours, and start lights the race drives.
 */

const ASPHALT_TONES: Record<string, number> = { apex_road: 0.072, apex_pitlane: 0.085, apex_runoff: 0.09 };
const GRASS = new Set(['apex_ground', 'apex_grass']);
/** Groups whose meshes throw shadows; the rest (ground, crowd, far scenery) only receive them. */
const SHADOW_CASTERS = new Set(['stands', 'pit', 'barriers', 'gantry', 'bridges', 'signage', 'trackside', 'nature']);
const GANTRY_LIGHT = /^apex_gantry_light_(\d)$/;
const RED = new Color('#ff2414');

function groupOf(mesh: Mesh): string {
  let node = mesh.parent;
  while (node?.parent && node.parent.name !== 'apex_circuit') node = node.parent;
  return node?.name ?? '';
}

function configure(material: Material, maxAnisotropy: number, lite: boolean) {
  if (!(material instanceof MeshStandardMaterial)) return;
  const name = material.name;
  if (name in ASPHALT_TONES) upgradeAsphalt(material, ASPHALT_TONES[name]);
  else if (GRASS.has(name)) upgradeGrass(material);
  else if (name === 'apex_gravel') upgradeGravel(material);
  else if (name === 'apex_fence') upgradeFence(material);
  else if (name === 'apex_crowd') upgradeCrowd(material);
  else if (name === 'apex_paint') {
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -2;
  } else if (name === 'apex_glass') {
    material.roughness = 0.08;
    material.metalness = 0.35;
    material.envMapIntensity = 1.4;
  } else if (name === 'apex_water') {
    material.color.set('#20404e');
    material.roughness = 0.06;
    material.metalness = 0.15;
    material.envMapIntensity = 1.3;
  } else if (name === 'apex_glass_green') {
    // The pods' tinted glazing reads darker than it is, under the cladding's shade.
    material.color.set('#1d3a37');
    material.envMapIntensity = 1.2;
  } else if (name === 'apex_aluminium') {
    // The wing pods' satin cladding: kept silver against the green the grass bounces into it.
    material.envMapIntensity = 0.55;
    material.emissive.set('#9aa2ab');
    material.emissiveIntensity = 0.22;
  } else if (GANTRY_LIGHT.test(name)) {
    material.emissive.copy(RED);
    material.emissiveIntensity = 0;
    material.toneMapped = false;
  }
  if (material.map) material.map.anisotropy = name.startsWith('poster_') ? maxAnisotropy : Math.min(4, maxAnisotropy);
  if (lite && material.name === 'apex_crowd') material.alphaTest = 0.3;
}

/** Kerb rows from the layout, as the racing surface wants them: it stops where a kerb starts. */
function layoutEdges(rows: number): SurfaceEdges {
  const left = new Float32Array(rows).fill(projectedTrack.halfWidth);
  const right = new Float32Array(rows).fill(projectedTrack.halfWidth);
  const kerbLeft = new Uint8Array(rows);
  const kerbRight = new Uint8Array(rows);
  for (let row = 0; row < rows; row += 1) {
    kerbLeft[row] = kerbAt(row / rows, 1) ? 1 : 0;
    kerbRight[row] = kerbAt(row / rows, -1) ? 1 : 0;
  }
  return { left, right, kerbLeft, kerbRight };
}

/** The grid boxes the field starts from: the engine's slots, then the player one row behind. */
function gridBoxes() {
  const slots = SHANGHAI_TRACK.gridSlots.slice(0, FIELD_SIZE - 1);
  const last = slots[slots.length - 1];
  return [
    ...slots,
    { distance: last.distance - GRID_ROW_METRES / projectedTrack.lengthMeters, lateral: -Math.sign(last.lateral || 1) * Math.abs(last.lateral) },
  ];
}

/**
 * The racing surface over the circuit's road, generated at high resolution
 * from the centreline: asphalt with a rubbered line and braking marks, crisp
 * track-limit lines, grid boxes and a chequered timing line.
 */
function RacingSurface({ root }: { root: Object3D }) {
  const { surface, marks } = useMemo(() => {
    const sampler = createSurfaceSampler(root, new Set(['apex_road']));
    const guide = computeRacingGuide(projectedTrack, 1280);
    const brake = (fraction: number) => {
      const index = Math.floor((((fraction % 1) + 1) % 1) * guide.length) % guide.length;
      return Math.max(0, Math.min(1, (guide[index].effort - 0.55) / 0.45));
    };
    return {
      surface: buildTrackSurface(projectedTrack, sampler, brake, layoutEdges(surfaceRows(projectedTrack))),
      marks: buildGridMarks(projectedTrack, gridBoxes(), sampler),
    };
  }, [root]);
  const road = useMemo(() => createRoadMaterial(), []);
  const paint = useMemo(() => createPaintMarkMaterial(), []);
  useEffect(() => () => {
    surface.dispose();
    marks.dispose();
    road.dispose();
    paint.dispose();
  }, [surface, marks, road, paint]);
  return (
    <group name="racing-surface">
      <mesh geometry={surface} material={road} receiveShadow />
      <mesh geometry={marks} material={paint} receiveShadow />
    </group>
  );
}

export function ApexCircuit({ quality, lights }: {
  quality: SceneQualityTier;
  /** How many of the five start lights are lit, read every frame. */
  lights?: () => number;
}) {
  const gltf = useGLTF(ASSETS.circuit);
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy());
  const lite = quality === 'mobile';
  const resources = useMemo(
    () => cloneSceneWithOwnedMaterials(gltf.scene, (material) => configure(material, maxAnisotropy, lite)),
    [gltf.scene, maxAnisotropy, lite],
  );
  useEffect(() => () => resources.dispose(), [resources]);

  const gantry = useMemo(() => {
    const found: MeshStandardMaterial[] = [];
    resources.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const group = groupOf(object);
      object.receiveShadow = group !== 'skyline';
      object.castShadow = !lite && SHADOW_CASTERS.has(group);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        const match = GANTRY_LIGHT.exec(material.name);
        if (match && material instanceof MeshStandardMaterial) found[Number(match[1]) - 1] = material;
      }
    });
    return found;
  }, [resources, lite]);

  useFrame(() => {
    const lit = lights?.() ?? 0;
    gantry.forEach((material, index) => {
      if (material) material.emissiveIntensity = index < lit ? 2 : 0;
    });
  });

  return (
    <>
      <primitive object={resources.scene} dispose={null} />
      <RacingSurface root={resources.scene} />
    </>
  );
}
