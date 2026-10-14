import { Color, MeshStandardMaterial, type Material } from 'three';

/**
 * Procedural circuit materials, computed in world space so the generated
 * racing surface and the supplied model's run-off, pit lane and grass share
 * one continuous texture with no tiling and no seams.
 *
 * Detail fades out by pixel footprint (`fwidth`), so the aggregate in the
 * asphalt is crisp at the chase camera and never shimmers in the distance.
 */

const NOISE = /* glsl */ `
  float trkHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float trkNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(trkHash(i), trkHash(i + vec2(1.0, 0.0)), f.x), mix(trkHash(i + vec2(0.0, 1.0)), trkHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float trkFbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int octave = 0; octave < 4; octave++) {
      sum += amp * trkNoise(p);
      p = p * 2.03 + vec2(17.1, 9.7);
      amp *= 0.5;
    }
    return sum;
  }
  // Fades a detail layer once one of its cells is smaller than about a pixel.
  float trkFade(float footprint, float cell) { return 1.0 - smoothstep(cell * 0.35, cell * 1.1, footprint); }
  float trkBand(float v, float lo, float hi) {
    float w = max(fwidth(v), 1e-4);
    return smoothstep(lo - w, lo + w, v) * (1.0 - smoothstep(hi - w, hi + w, v));
  }
  // Bump mapping from a height field's screen derivatives (as three's bumpmap).
  vec3 trkBump(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
    vec3 sigmaX = dFdx(surfPos);
    vec3 sigmaY = dFdy(surfPos);
    vec3 r1 = cross(sigmaY, surfNorm);
    vec3 r2 = cross(surfNorm, sigmaX);
    float det = dot(sigmaX, r1) * faceDir;
    vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
    return normalize(abs(det) * surfNorm - grad);
  }

  // Asphalt: patched base tone, mid-scale mottling, aggregate grain and
  // light stone chips. Returns albedo; writes roughness and a height for bump.
  vec3 trkAsphalt(vec2 xz, float footprint, float tone, out float rough, out float height) {
    float patches = trkFbm(xz * 0.045 + 3.1);
    float mottle = trkFbm(xz * 0.6);
    float grainFade = trkFade(footprint, 1.0 / 42.0);
    float grain = trkNoise(xz * 42.0) * 0.6 + trkNoise(xz * 97.0 + 3.0) * 0.4 * trkFade(footprint, 1.0 / 97.0);
    float chipFade = trkFade(footprint, 1.0 / 120.0);
    float chips = smoothstep(0.8, 0.9, trkNoise(xz * 120.0 + 5.0)) * chipFade;
    float g = tone * (1.0 + 0.22 * (patches - 0.5) + 0.12 * (mottle - 0.5) + 0.18 * (grain - 0.5) * grainFade + chips * 0.3);
    rough = 0.9 - 0.06 * (grain - 0.5) * grainFade - chips * 0.12;
    height = (grain * 0.6 + chips * 0.6) * grainFade;
    return vec3(g * 1.01, g, g * 0.985);
  }
`;

type Shader = Parameters<NonNullable<Material['onBeforeCompile']>>[0];

function addWorldPosition(shader: Shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      varying vec3 vTrkWorld;`)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vTrkWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
}

/**
 * The generated racing surface: asphalt with the rubbered line laid down
 * where cars run, darker braking streaks into the corners, and the white
 * track-limit lines at exactly the half-width the car is judged against.
 */
export function createRoadMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0, envMapIntensity: 0.7 });
  material.name = 'track-surface';
  material.onBeforeCompile = (shader) => {
    addWorldPosition(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aTrack;
        attribute vec2 aLine;
        attribute vec2 aEdge;
        varying vec2 vTrack;
        varying vec2 vLine;
        varying vec2 vEdge;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTrack = aTrack;
        vLine = aLine;
        vEdge = aEdge;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTrkWorld;
        varying vec2 vTrack;
        varying vec2 vLine;
        varying vec2 vEdge;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 trkXZ = vTrkWorld.xz;
        float trkPx = length(fwidth(trkXZ));
        float trkRough;
        float trkHeight;
        vec3 trkCol = trkAsphalt(trkXZ, trkPx, 0.072, trkRough, trkHeight);
        float lat = vTrack.x;
        float along = vTrack.y;
        // Rubber: a dark groove round the racing line, wider and deeper where cars brake.
        float grooveW = 1.35 + 0.7 * vLine.y;
        float rubber = exp(-pow((lat - vLine.x) / grooveW, 2.0)) * (0.42 + 0.35 * vLine.y);
        // Braking streaks: long thin marks, laid in the braking zones near the line.
        float streakNoise = trkNoise(vec2(lat * 7.0, along * 0.18)) * trkNoise(vec2(lat * 3.1 + 4.0, along * 0.05));
        float streaks = smoothstep(0.32, 0.6, streakNoise) * vLine.y * exp(-pow((lat - vLine.x) / 2.4, 2.0)) * trkFade(trkPx, 0.12);
        trkCol *= 1.0 - 0.36 * rubber - 0.32 * streaks;
        // Track limits: white lines, the slightly scruffy paint of a real circuit.
        float lineAt = lat >= 0.0 ? vEdge.x : vEdge.y;
        float paint = trkBand(abs(lat), lineAt - 0.24, lineAt) * (0.86 + 0.14 * trkNoise(trkXZ * 9.0));
        trkCol = mix(trkCol, vec3(0.8, 0.8, 0.78), paint);
        diffuseColor.rgb = trkCol;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(trkRough, 0.74, rubber * 0.7);
        roughnessFactor = mix(roughnessFactor, 0.62, paint);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = trkBump(-vViewPosition, normal, vec2(dFdx(trkHeight), dFdy(trkHeight)) * 0.55 * (1.0 - paint * 0.7), faceDirection);`);
  };
  material.customProgramCacheKey = () => 'track-surface-v2';
  return material;
}

/** Turns a supplied material into world-space asphalt (run-off, pit lane, untouched road). */
export function upgradeAsphalt(material: MeshStandardMaterial, tone = 0.125) {
  material.map = null;
  material.color.set('#ffffff');
  material.metalness = 0;
  material.roughness = 0.9;
  material.onBeforeCompile = (shader) => {
    addWorldPosition(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTrkWorld;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float trkRough;
        float trkHeight;
        diffuseColor.rgb = trkAsphalt(vTrkWorld.xz, length(fwidth(vTrkWorld.xz)), ${tone.toFixed(3)}, trkRough, trkHeight);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = trkRough;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = trkBump(-vViewPosition, normal, vec2(dFdx(trkHeight), dFdy(trkHeight)) * 0.55, faceDirection);`);
  };
  material.customProgramCacheKey = () => `track-asphalt-${tone}`;
  material.needsUpdate = true;
}

/**
 * Mown grass: two greens in broad patches, diagonal mowing stripes as on a
 * groomed circuit verge, and a fine blade texture close up.
 */
export function upgradeGrass(material: MeshStandardMaterial) {
  material.map = null;
  material.color.set('#ffffff');
  material.metalness = 0;
  material.roughness = 0.96;
  material.onBeforeCompile = (shader) => {
    addWorldPosition(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTrkWorld;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 gXZ = vTrkWorld.xz;
        float gPx = length(fwidth(gXZ));
        float broad = trkFbm(gXZ * 0.02);
        float clumps = trkFbm(gXZ * 0.35);
        float blades = trkNoise(gXZ * 34.0) * trkFade(gPx, 1.0 / 34.0);
        // Mowing stripes, 7 m wide, laid diagonally across the verges.
        float stripe = smoothstep(0.42, 0.58, abs(fract((gXZ.x * 0.6 + gXZ.y * 0.8) / 14.0) * 2.0 - 1.0));
        vec3 dry = vec3(0.235, 0.33, 0.12);
        vec3 lush = vec3(0.13, 0.27, 0.075);
        vec3 grass = mix(lush, dry, smoothstep(0.35, 0.7, broad));
        grass *= 0.9 + 0.16 * stripe + 0.12 * (clumps - 0.5) + 0.18 * (blades - 0.5);
        diffuseColor.rgb = grass;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = 0.92 + 0.06 * (1.0 - stripe);`);
  };
  material.customProgramCacheKey = () => 'track-grass-v1';
  material.needsUpdate = true;
}

/** White paint for grid boxes and the start line. */
export function createPaintMarkMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: new Color(0.82, 0.82, 0.8), roughness: 0.62, metalness: 0 });
  material.name = 'track-paint';
  return material;
}
