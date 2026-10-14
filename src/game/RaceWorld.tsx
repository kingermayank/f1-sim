import { Environment as SkyLight, useGLTF } from '@react-three/drei';
import { Suspense, useEffect, useMemo } from 'react';
import { ASSETS } from '../assets/asset-registry';
import { Environment, KERB_MATERIAL, SUN_DIRECTION, type ShadowFocus } from '../scene/Environment';
import type { SceneQualityTier } from '../scene/RaceScene';
import { SHANGHAI_TRACK } from '../track/shanghai-track';
import { FIELD_SIZE, GRID_ROW_METRES, projectedTrack } from './game-store';
import { computeRacingGuide } from './racing-line';
import { createSkyTexture, HORIZON_HAZE } from './sky';
import { createPaintMarkMaterial, createRoadMaterial } from './track-materials';
import { buildGridMarks, buildTrackSurface, createSurfaceSampler, measureKerbEdges, surfaceRows } from './track-surface';

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
 * The racing surface itself, generated over the supplied circuit at high
 * resolution: asphalt with a rubbered line and braking marks, crisp
 * track-limit lines, grid boxes and a chequered timing line.
 */
function RacingSurface() {
  const gltf = useGLTF(ASSETS.track);
  const { surface, marks } = useMemo(() => {
    const sampler = createSurfaceSampler(gltf.scene, new Set(['tarmac', 'Line_asf']));
    const guide = computeRacingGuide(projectedTrack, 1280);
    const brake = (fraction: number) => {
      const index = Math.floor((((fraction % 1) + 1) % 1) * guide.length) % guide.length;
      return Math.max(0, Math.min(1, (guide[index].effort - 0.55) / 0.45));
    };
    const edges = measureKerbEdges(projectedTrack, gltf.scene, new Set([KERB_MATERIAL, 'Kerb_giallo']), surfaceRows(projectedTrack), projectedTrack.halfWidth);
    return {
      surface: buildTrackSurface(projectedTrack, sampler, brake, edges),
      marks: buildGridMarks(projectedTrack, gridBoxes(), sampler),
    };
  }, [gltf.scene]);
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

/**
 * Everything the driving game draws except the cars: the supplied circuit
 * with procedural asphalt and grass, the generated racing surface, and a
 * painted sky that is both the background and the light the cars reflect.
 */
export function RaceWorld({ quality, shadowFocus }: { quality: SceneQualityTier; shadowFocus?: () => ShadowFocus }) {
  const sky = useMemo(() => createSkyTexture(SUN_DIRECTION), []);
  useEffect(() => () => sky.dispose(), [sky]);
  return (
    <>
      <SkyLight map={sky} background environmentIntensity={0.85} />
      <fog attach="fog" args={[HORIZON_HAZE, 650, 3600]} />
      <Environment quality={quality} shadowFocus={shadowFocus} racingLine={false} atmosphere={false} procedural />
      <Suspense fallback={null}><RacingSurface /></Suspense>
    </>
  );
}
