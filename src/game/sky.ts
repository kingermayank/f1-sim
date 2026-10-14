import { CanvasTexture, EquirectangularReflectionMapping, SRGBColorSpace, Vector3 } from 'three';

/**
 * A clear afternoon sky over the circuit, painted once into an
 * equirectangular texture: deep blue overhead fading to a pale haze at the
 * horizon, a bright glow round the sun, fair-weather cumulus, and a dull
 * green-grey ground below for reflections. The same texture is the visible
 * background and the light the cars' paint reflects, so they always agree.
 */

function hash(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number): number {
  let sum = 0;
  let amp = 0.5;
  for (let octave = 0; octave < 5; octave += 1) {
    sum += amp * noise(x, y);
    x = x * 2.02 + 13.7;
    y = y * 2.02 + 7.3;
    amp *= 0.5;
  }
  return sum;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createSkyTexture(sun: Vector3, width = 1536, height = 768): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(width, height);
  const data = image.data;
  const s = sun.clone().normalize();
  const zenith = [0.2, 0.42, 0.74];
  const horizon = [0.8, 0.87, 0.92];
  const ground = [0.33, 0.36, 0.31];
  for (let py = 0; py < height; py += 1) {
    // Row 0 is the top of the sky (the texture is flipped on upload).
    const elevation = (0.5 - (py + 0.5) / height) * Math.PI;
    const cosE = Math.cos(elevation);
    const sinE = Math.sin(elevation);
    for (let px = 0; px < width; px += 1) {
      const azimuth = ((px + 0.5) / width - 0.5) * Math.PI * 2;
      const dx = cosE * Math.cos(azimuth);
      const dz = cosE * Math.sin(azimuth);
      const dy = sinE;
      let r: number; let g: number; let b: number;
      if (dy >= 0) {
        const t = Math.pow(1 - dy, 3.2);
        r = mix(zenith[0], horizon[0], t);
        g = mix(zenith[1], horizon[1], t);
        b = mix(zenith[2], horizon[2], t);
        const angle = Math.acos(Math.max(-1, Math.min(1, dx * s.x + dy * s.y + dz * s.z)));
        const glow = Math.exp(-angle * 4.5) * 0.35 + Math.exp(-angle * 24) * 0.5;
        r += glow; g += glow * 0.94; b += glow * 0.82;
        if (angle < 0.012) { r = 1; g = 0.99; b = 0.95; }
        // Clouds on a plane overhead, thinning towards the horizon.
        if (dy > 0.015) {
          const k = 1 / (dy + 0.12);
          const cx = dx * k * 2.1;
          const cz = dz * k * 2.1;
          const density = smooth(0.55, 0.78, fbm(cx * 1.4 + 3, cz * 1.4)) * smooth(0.015, 0.2, dy);
          if (density > 0) {
            const shade = 0.78 + 0.22 * smooth(0.5, 0.9, fbm(cx * 3 + 11, cz * 3 + 5));
            const lit = Math.min(1, shade + Math.exp(-angle * 3) * 0.25);
            r = mix(r, lit, density * 0.9);
            g = mix(g, lit * 0.99, density * 0.9);
            b = mix(b, lit * 0.98, density * 0.9);
          }
        }
      } else {
        const t = smooth(-0.12, 0, dy);
        r = mix(ground[0], horizon[0] * 0.92, t);
        g = mix(ground[1], horizon[1] * 0.92, t);
        b = mix(ground[2], horizon[2] * 0.9, t);
      }
      const offset = (py * width + px) * 4;
      data[offset] = Math.min(255, r * 255);
      data[offset + 1] = Math.min(255, g * 255);
      data[offset + 2] = Math.min(255, b * 255);
      data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** The horizon haze, for fog that melts into the sky. */
export const HORIZON_HAZE = '#c4d4df';
