import {
  CanvasTexture,
  Color,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector4,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { FINISHES, PATTERNS, type Livery } from './liveries';

/**
 * Materials for the code-drawn car.
 *
 * The paint is a MeshPhysicalMaterial whose colour, roughness, metalness and
 * clearcoat are computed per fragment from the car-space position: the livery
 * pattern runs across every painted part as one surface, with no UVs and so
 * no seams. It holds two complete liveries, `from` (what was on the car) and
 * `to` (what is going on), and a wipe: a sphere growing from a point on the
 * car. Inside the sphere the new paint shows, outside the old, and a thin hot
 * shell rides its surface. Changing team is therefore paint travelling over
 * the car rather than a model swap.
 */

export interface PaintUniforms {
  [name: string]: { value: unknown };
  uFromA: { value: Color };
  uFromB: { value: Color };
  uFromC: { value: Color };
  uFromPattern: { value: number };
  /** roughness, metalness, clearcoat, clearcoatRoughness */
  uFromFinish: { value: Vector4 };
  /** iridescence, flake */
  uFromExtra: { value: Vector4 };
  uFromNumber: { value: Texture | null };
  uFromInk: { value: Color };
  uFromCam: { value: Color };
  uToA: { value: Color };
  uToB: { value: Color };
  uToC: { value: Color };
  uToPattern: { value: number };
  uToFinish: { value: Vector4 };
  uToExtra: { value: Vector4 };
  uToNumber: { value: Texture | null };
  uToInk: { value: Color };
  uToCam: { value: Color };
  /** Wipe sphere: centre in car space (xyz) and current radius (w). */
  uWipe: { value: Vector4 };
  /** 1 while a wipe runs; the old livery is only evaluated then. */
  uWipeOn: { value: number };
  /** Colour of the hot shell, linear and above 1 so bloom catches it. */
  uGlowCol: { value: Color };
}

/** Everything that differs between two cars' paint. */
export interface PaintState {
  livery: Livery;
  number: Texture | null;
  cam: string;
}

function finishVectors(livery: Livery): { finish: Vector4; extra: Vector4 } {
  const finish = FINISHES[livery.finish];
  return {
    finish: new Vector4(finish.roughness, finish.metalness, finish.clearcoat, finish.clearcoatRoughness),
    extra: new Vector4(finish.iridescence, finish.flake, 0, 0),
  };
}

export function createPaintUniforms(livery: Livery): PaintUniforms {
  const { finish, extra } = finishVectors(livery);
  return {
    uFromA: { value: new Color(livery.primary) },
    uFromB: { value: new Color(livery.secondary) },
    uFromC: { value: new Color(livery.accent) },
    uFromPattern: { value: PATTERNS[livery.pattern] },
    uFromFinish: { value: finish.clone() },
    uFromExtra: { value: extra.clone() },
    uFromNumber: { value: null },
    uFromInk: { value: new Color(livery.numberInk) },
    uFromCam: { value: new Color('#111214') },
    uToA: { value: new Color(livery.primary) },
    uToB: { value: new Color(livery.secondary) },
    uToC: { value: new Color(livery.accent) },
    uToPattern: { value: PATTERNS[livery.pattern] },
    uToFinish: { value: finish },
    uToExtra: { value: extra },
    uToNumber: { value: null },
    uToInk: { value: new Color(livery.numberInk) },
    uToCam: { value: new Color('#111214') },
    uWipe: { value: new Vector4(0, 0.25, 2.75, 0) },
    uWipeOn: { value: 0 },
    uGlowCol: { value: new Color(2.5, 2.3, 2.0) },
  };
}

/** Writes a paint state into the `to` slot. */
export function setPaint(uniforms: PaintUniforms, state: PaintState) {
  const { livery } = state;
  const { finish, extra } = finishVectors(livery);
  uniforms.uToA.value.set(livery.primary);
  uniforms.uToB.value.set(livery.secondary);
  uniforms.uToC.value.set(livery.accent);
  uniforms.uToPattern.value = PATTERNS[livery.pattern];
  uniforms.uToFinish.value.copy(finish);
  uniforms.uToExtra.value.copy(extra);
  uniforms.uToNumber.value = state.number;
  uniforms.uToInk.value.set(livery.numberInk);
  uniforms.uToCam.value.set(state.cam);
}

/** Copies what is showing (`to`) into `from`, so a new wipe starts from the car as it looks. */
export function settlePaint(uniforms: PaintUniforms) {
  uniforms.uFromA.value.copy(uniforms.uToA.value);
  uniforms.uFromB.value.copy(uniforms.uToB.value);
  uniforms.uFromC.value.copy(uniforms.uToC.value);
  uniforms.uFromPattern.value = uniforms.uToPattern.value;
  uniforms.uFromFinish.value.copy(uniforms.uToFinish.value);
  uniforms.uFromExtra.value.copy(uniforms.uToExtra.value);
  uniforms.uFromNumber.value = uniforms.uToNumber.value;
  uniforms.uFromInk.value.copy(uniforms.uToInk.value);
  uniforms.uFromCam.value.copy(uniforms.uToCam.value);
}

/**
 * The shell's colour: the new primary brightened in linear space, so even a
 * navy livery lays down a bright, tinted rim.
 */
export function glowColour(livery: Livery, target = new Color()): Color {
  const primary = new Color(livery.primary);
  return target.setRGB(primary.r * 2.2 + 0.6, primary.g * 2.2 + 0.6, primary.b * 2.2 + 0.6);
}

/** Shared GLSL: hashing, value noise and the livery patterns. */
const PAINT_COMMON = /* glsl */ `
  varying vec3 vCarPos;
  varying vec3 vCarNormal;
  varying float vTone;
  uniform vec3 uFromA; uniform vec3 uFromB; uniform vec3 uFromC;
  uniform float uFromPattern; uniform vec4 uFromFinish; uniform vec4 uFromExtra;
  uniform sampler2D uFromNumber; uniform vec3 uFromInk; uniform vec3 uFromCam;
  uniform vec3 uToA; uniform vec3 uToB; uniform vec3 uToC;
  uniform float uToPattern; uniform vec4 uToFinish; uniform vec4 uToExtra;
  uniform sampler2D uToNumber; uniform vec3 uToInk; uniform vec3 uToCam;
  uniform vec4 uWipe; uniform float uWipeOn; uniform vec3 uGlowCol;

  float carHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float carNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(carHash(i), carHash(i + vec3(1, 0, 0)), f.x),
                   mix(carHash(i + vec3(0, 1, 0)), carHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(carHash(i + vec3(0, 0, 1)), carHash(i + vec3(1, 0, 1)), f.x),
                   mix(carHash(i + vec3(0, 1, 1)), carHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }

  // Anti-aliased band: 1 inside [lo, hi] of a field, soft over one pixel.
  float band(float v, float lo, float hi) {
    float w = max(fwidth(v), 1e-4);
    return smoothstep(lo - w, lo + w, v) * (1.0 - smoothstep(hi - w, hi + w, v));
  }
  float edge(float v, float at) {
    float w = max(fwidth(v), 1e-4);
    return smoothstep(at - w, at + w, v);
  }

  // The waistline the two-tone liveries split on: it rises towards the nose.
  float waist(vec3 p) { return 0.47 + 0.055 * p.z - 0.05 * smoothstep(0.6, 2.4, p.z); }

  vec3 livery(float pattern, vec3 A, vec3 B, vec3 C, vec3 p, vec3 n) {
    float ax = abs(p.x);
    vec3 col = A;
    if (pattern < 0.5) {
      // solid: one colour, a dark skirt and an accent pinstripe at the waist.
      col = mix(col, B, 1.0 - edge(p.y, 0.16));
      col = mix(col, C, band(p.y - waist(p), -0.006, 0.006) * step(0.3, ax));
    } else if (pattern < 1.5) {
      // twoTone: lower half B, upper A, an accent pinstripe on the line.
      float d = p.y - waist(p) + 0.04 * smoothstep(-0.4, -1.6, p.z);
      col = mix(B, A, edge(d, 0.0));
      col = mix(col, C, band(d, 0.006, 0.018));
      // The nose top and wing endplates stay in the main colour.
      col = mix(col, A, step(1.45, p.z) * step(0.0, n.y) * (1.0 - step(0.8, ax)));
    } else if (pattern < 2.5) {
      // spine: a band along the top of the car, accent edges, darker floor line.
      float w = 0.085 + 0.03 * smoothstep(1.8, 0.4, p.z) - 0.025 * smoothstep(-0.6, -1.8, p.z);
      float onTop = smoothstep(0.25, 0.5, n.y);
      float spine = band(ax, -1.0, w) * onTop;
      col = mix(A, B, spine);
      col = mix(col, C, band(ax, w, w + 0.014) * onTop);
      col = mix(col, B, band(p.y, 0.0, 0.17) * step(0.25, ax));
    } else if (pattern < 3.5) {
      // diagonal: raked plane through the sidepods, accent band between.
      float d = p.z + 0.85 * (p.y - 0.4) + 0.12 * sin(p.x * 6.0);
      col = mix(B, A, edge(d, 0.1));
      col = mix(col, C, band(d, 0.04, 0.1));
    } else if (pattern < 4.5) {
      // arrow: a forward chevron along nose and sidepods.
      float v = p.z - 1.1 * ax + 0.35 * (p.y - 0.45);
      col = mix(A, B, band(v, -0.95, -0.55));
      col = mix(col, C, band(v, -0.55, -0.52) + band(v, -0.98, -0.95));
      col = mix(col, B, step(1.95, p.z) * step(0.0, n.y) * band(ax, -1.0, 0.05));
    } else if (pattern < 5.5) {
      // halftone: A at the front dissolving into B through a dot screen.
      float t = smoothstep(0.7, -1.3, p.z + 0.2 * p.y);
      vec3 q = p * 26.0;
      // Dots projected along the dominant normal axis so they stay round.
      vec3 an = abs(n);
      vec2 uv = an.x > max(an.y, an.z) ? q.zy : (an.y > an.z ? q.xz : q.xy);
      vec2 cell = fract(uv) - 0.5;
      float r = sqrt(clamp(t, 0.0, 1.0)) * 0.62;
      float dotMask = 1.0 - smoothstep(r - fwidth(uv.x), r + fwidth(uv.x), length(cell));
      // Where the screen is too fine for the pixel, fall back to the average.
      float fine = smoothstep(0.35, 0.7, fwidth(uv.x));
      float cover = mix(dotMask, t, fine);
      col = mix(A, B, cover);
      col = mix(col, C, band(p.y, 0.62, 0.64) * step(0.2, ax) * step(-0.2, p.z) * step(p.z, 0.65));
    } else if (pattern < 6.5) {
      // nose: dark base, a coloured band low along the sidepods, a bright nose tip.
      col = mix(A, B, band(p.y - 0.008 * p.z * p.z, 0.10, 0.27) * step(0.3, ax) * step(-1.2, p.z));
      col = mix(col, C, edge(p.z, 2.3));
      col = mix(col, C, band(p.y - waist(p), 0.02, 0.032) * step(0.32, ax));
      // Rear-wing endplates carry the band colour.
      col = mix(col, B, step(0.5, ax) * step(p.z, -1.95) * step(0.45, p.y));
    } else {
      // stripes: three raked speed stripes along each side, light spine.
      float v = p.y - 0.11 * p.z;
      float s = band(v, 0.42, 0.455) + band(v, 0.48, 0.5) + band(v, 0.525, 0.535);
      col = mix(A, B, s * step(0.22, ax));
      col = mix(col, C, band(ax, -1.0, 0.012) * step(0.3, n.y));
      col = mix(col, B, step(2.1, p.z) * step(0.0, n.y));
    }
    return col;
  }

  // Driver number: projected down onto the nose top, and across the shark fin.
  float inUnit(vec2 uv) { return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0); }
  float numberMask(sampler2D numberMap, vec3 p, vec3 n) {
    // On the nose the number reads upright from in front of the car.
    // Sampled unconditionally so the derivatives stay defined; the masks
    // pick where it shows.
    vec2 uvNose = vec2(p.x / 0.17 + 0.5, (p.z - 1.95) / 0.26 + 0.5);
    float nose = texture2D(numberMap, clamp(uvNose, 0.0, 1.0)).a * inUnit(uvNose) * step(0.45, n.y);
    // Fin, both faces, read the right way round from either side.
    vec2 uvFin = vec2((p.z + 1.12) / 0.34 + 0.5, (p.y - 0.69) / 0.17 + 0.5);
    vec2 uv = vec2(n.x > 0.0 ? 1.0 - uvFin.x : uvFin.x, uvFin.y);
    float fin = texture2D(numberMap, clamp(uv, 0.0, 1.0)).a * inUnit(uvFin) * step(abs(p.x), 0.012) * step(0.6, abs(n.x));
    return max(nose, fin);
  }

  // Bodywork details every livery shares: cooling louvres cut into the
  // sidepod tops, and the dark hairline joints between panels.
  float details(vec3 p, vec3 n) {
    float ax = abs(p.x);
    float louvreZone = step(-1.12, p.z) * step(p.z, -0.62) * step(0.34, ax) * step(ax, 0.56) * smoothstep(0.55, 0.8, n.y);
    float slot = fract(p.z * 52.0);
    float louvres = louvreZone * band(slot, 0.0, 0.45);
    float joints = band(p.z - 1.92, -0.0007, 0.0007) + band(p.z + 0.37, -0.0007, 0.0007) * step(0.55, p.y)
      + band(p.z + 0.95, -0.0007, 0.0007) * step(0.3, ax);
    return clamp(louvres * 0.88 + joints * 0.7, 0.0, 1.0);
  }
`;

let paintId = 0;

/**
 * Creates the paint material for one car. Its uniforms are returned so the
 * caller can drive liveries and sweeps without recompiling.
 */
export function createPaintMaterial(
  livery: Livery,
  options: { uniforms?: PaintUniforms; lite?: boolean } = {},
): { material: MeshPhysicalMaterial; uniforms: PaintUniforms } {
  const uniforms = options.uniforms ?? createPaintUniforms(livery);
  const lite = options.lite ?? false;
  const material = new MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.3,
    metalness: 0,
    // A distant car skips the clear coat and thin film: same livery, cheaper light.
    clearcoat: lite ? 0 : 1,
    clearcoatRoughness: 0.05,
    // A trace of thin film keeps the iridescence branch compiled in; the
    // shader sets the real amount per fragment (zero unless pearl).
    iridescence: lite ? 0 : 0.0001,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [100, 420],
    envMapIntensity: 1,
  });
  material.name = `car-paint-${paintId += 1}`;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float tone;
        varying vec3 vCarPos;
        varying vec3 vCarNormal;
        varying float vTone;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCarPos = position;
        vCarNormal = normal;
        vTone = tone;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${PAINT_COMMON}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 carN = normalize(vCarNormal);
        // Wipe: inside the growing sphere is the new paint, outside the old.
        float wipeD = length(vCarPos - uWipe.xyz);
        float fresh = uWipeOn > 0.5 ? step(wipeD, uWipe.w) : 1.0;
        vec3 paint = livery(uToPattern, uToA, uToB, uToC, vCarPos, carN);
        vec4 finishNow = uToFinish;
        vec4 extraNow = uToExtra;
        float inkTo = numberMask(uToNumber, vCarPos, carN);
        paint = mix(paint, uToInk, inkTo);
        vec3 cam = uToCam;
        float numberInk = inkTo;
        if (uWipeOn > 0.5) {
          vec3 old = livery(uFromPattern, uFromA, uFromB, uFromC, vCarPos, carN);
          float inkFrom = numberMask(uFromNumber, vCarPos, carN);
          old = mix(old, uFromInk, inkFrom);
          paint = mix(old, paint, fresh);
          finishNow = mix(uFromFinish, uToFinish, fresh);
          extraNow = mix(uFromExtra, uToExtra, fresh);
          cam = mix(uFromCam, uToCam, fresh);
          numberInk = mix(inkFrom, inkTo, fresh);
        }
        // Louvres and panel joints, under every livery.
        float detail = details(vCarPos, carN) * (1.0 - numberInk);
        paint *= 1.0 - detail * 0.86;
        // Metallic flake: sparse bright grains that only show up close.
        float grain = carHash(floor(vCarPos * 1400.0));
        float flakeShow = extraNow.y * step(0.9, grain) * (1.0 - smoothstep(0.0006, 0.0025, length(fwidth(vCarPos))));
        paint *= 1.0 + flakeShow * 0.65;
        // Openings and the camera pod.
        float dark = clamp(vTone, 0.0, 1.0) * (1.0 - step(1.5, vTone));
        paint = mix(paint, vec3(0.012, 0.013, 0.015), dark);
        paint = mix(paint, cam, step(1.5, vTone));
        diffuseColor.rgb = paint;
        // The hot shell riding the front of the wipe.
        float shell = uWipeOn * exp(-pow((wipeD - uWipe.w) / 0.045, 2.0));
        `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(finishNow.x, 0.85, max(dark, detail));`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(finishNow.y, 0.0, dark);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat = mix(finishNow.z, 0.0, max(dark, detail)) * (1.0 - numberInk * 0.3);
          material.clearcoatRoughness = clamp(finishNow.w, 0.02, 1.0);
        #endif
        #ifdef USE_IRIDESCENCE
          material.iridescence = extraNow.x * (1.0 - dark);
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uGlowCol * shell;`);
  };
  // Every car shares one compiled program; uniforms differ per material.
  material.customProgramCacheKey = () => (lite ? 'car-paint-v2-lite' : 'car-paint-v2');
  return { material, uniforms };
}

const CARBON_COMMON = /* glsl */ `
  varying vec3 vCarPos;
  varying vec3 vCarNormal;
  // 2x2 twill weave in car space, projected along the dominant normal axis.
  float twill(vec3 p, vec3 n, out float fade) {
    vec3 an = abs(n);
    vec2 uv = an.x > max(an.y, an.z) ? p.zy : (an.y > an.z ? p.xz : p.xy);
    uv *= 150.0;
    // The weave is finer than a pixel at any distance: fade to its average.
    fade = 1.0 - smoothstep(0.25, 0.6, length(fwidth(uv)));
    vec2 cell = floor(uv);
    vec2 f = fract(uv);
    float over = step(2.0, mod(cell.x + cell.y, 4.0));
    float across = mix(sin(f.y * 3.14159), sin(f.x * 3.14159), over);
    return mix(0.5, across, fade);
  }
`;

/** Bare carbon: a dark clear-coated twill weave, procedurally drawn. */
export function createCarbonMaterial(): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    color: '#121316',
    roughness: 0.42,
    metalness: 0.1,
    clearcoat: 0.3,
    clearcoatRoughness: 0.14,
    envMapIntensity: 0.6,
  });
  material.name = 'car-carbon';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCarPos;
        varying vec3 vCarNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCarPos = position;
        vCarNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${CARBON_COMMON}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float weaveFade;
        float weave = twill(vCarPos, normalize(vCarNormal), weaveFade);
        diffuseColor.rgb *= 0.7 + weave * 0.6;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.48, 0.28, weave);`);
  };
  material.customProgramCacheKey = () => 'car-carbon-v1';
  return material;
}

/** Slick tyre: rubber with a compound band on each sidewall. */
export function createTyreMaterial(band: string, halfWidth: number): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#17181a', roughness: 0.88, metalness: 0 });
  material.name = 'car-tyre';
  const uniforms = { uBand: { value: new Color(band) }, uHalfWidth: { value: halfWidth } };
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWheelPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWheelPos = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWheelPos;
        uniform vec3 uBand;
        uniform float uHalfWidth;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wheelR = length(vWheelPos.yz);
        float side = abs(vWheelPos.x) / uHalfWidth;
        float onWall = smoothstep(0.8, 0.9, side);
        float bandW = fwidth(wheelR) * 1.2;
        float stripe = smoothstep(0.296 - bandW, 0.296 + bandW, wheelR) * (1.0 - smoothstep(0.309 - bandW, 0.309 + bandW, wheelR));
        diffuseColor.rgb = mix(diffuseColor.rgb, uBand, stripe * onWall);
        // Scrubbed shoulders are a touch lighter than the tread.
        diffuseColor.rgb *= 1.0 + 0.25 * smoothstep(0.34, 0.355, wheelR) * smoothstep(0.55, 0.85, side);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.9, 0.62, stripe * onWall);`);
  };
  material.customProgramCacheKey = () => 'car-tyre-v1';
  return material;
}

/** Compound colours, as painted on the sidewall. */
export const COMPOUNDS = { soft: '#e3262f', medium: '#f2c315', hard: '#eef0f2' } as const;

const numberTextures = new Map<number, CanvasTexture>();

/**
 * The driver number for the nose and fin decals. One canvas per number,
 * shared by every car that carries it and redrawn once the display face has
 * loaded.
 */
export function numberTexture(number: number): CanvasTexture {
  let texture = numberTextures.get(number);
  if (!texture) {
    texture = createNumberTexture(number);
    numberTextures.set(number, texture);
  }
  return texture;
}

function createNumberTexture(number: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  context.clearRect(0, 0, 256, 256);
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '800 168px "Formula1 Wide", "Formula1 Display", "Arial Black", sans-serif';
  const draw = () => {
    context.clearRect(0, 0, 256, 256);
    context.fillText(String(number), 128, 136, 236);
  };
  draw();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  if (typeof document !== 'undefined' && document.fonts?.load) {
    document.fonts.load(context.font).then(() => { draw(); texture.needsUpdate = true; }).catch(() => undefined);
  }
  return texture;
}
