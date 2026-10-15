import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  LineBasicMaterial,
  LineSegments,
  NormalBlending,
  Points,
  PointsMaterial,
  type Texture,
} from 'three';
import { kerbAt } from '../track/circuit-layout';
import { gameStore, projectedTrack } from './game-store';

/**
 * What a racing car throws off, as the camera sees it.
 *
 * - Sparks: the titanium skid blocks under the floor touch the track at high
 *   speed and over kerbs, throwing short-lived bright streaks back from the
 *   car's floor.
 * - Dust: off the road, the rear tyres kick up grass and gravel dust that
 *   hangs and spreads behind the car.
 *
 * Both are small fixed pools of particles updated on the CPU each frame, so
 * the cost is flat however much is going on.
 */

const SPARKS = 160;
const DUST = 90;
const GRAVITY = 9.8;

function softDot(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

interface Particle {
  life: number;
  age: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
}

function pool(size: number): Particle[] {
  return Array.from({ length: size }, () => ({ life: 0, age: 1, x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0 }));
}

export function CarEffects({ lite = false }: { lite?: boolean }) {
  const dot = useMemo(() => softDot(), []);
  const sparks = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(SPARKS * 2 * 3), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(SPARKS * 2 * 3), 3));
    const material = new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    const lines = new LineSegments(geometry, material);
    lines.frustumCulled = false;
    lines.renderOrder = 3;
    const heads = new BufferGeometry();
    heads.setAttribute('position', geometry.getAttribute('position'));
    heads.setAttribute('color', geometry.getAttribute('color'));
    const glow = new Points(heads, new PointsMaterial({
      size: 0.16, map: dot, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    glow.frustumCulled = false;
    glow.renderOrder = 3;
    return { lines, glow, particles: pool(SPARKS) };
  }, [dot]);
  const dust = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(DUST * 3), 3));
    // RGBA: the alpha fades each puff in and out.
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(DUST * 4), 4));
    const material = new PointsMaterial({
      size: 2.6, map: dot, vertexColors: true, transparent: true, opacity: 0.6, blending: NormalBlending, depthWrite: false,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 2;
    return { points, particles: pool(DUST) };
  }, [dot]);

  useEffect(() => () => {
    dot.dispose();
    sparks.lines.geometry.dispose();
    (sparks.lines.material as LineBasicMaterial).dispose();
    (sparks.glow.material as PointsMaterial).dispose();
    dust.points.geometry.dispose();
    (dust.points.material as PointsMaterial).dispose();
  }, [dot, sparks, dust]);

  const sparkColour = useMemo(() => new Color(), []);
  const dustColour = useMemo(() => new Color('#a89574'), []);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const state = gameStore.getState();
    const { car, surfaceY, phase, paused } = state;
    if (paused) return;
    const racing = phase === 'racing' || phase === 'finished';
    const fx = Math.cos(car.heading);
    const fz = Math.sin(car.heading);
    // The lateral axis (positive is the projection's positive side).
    const nx = -fz;
    const nz = fx;
    const speed = car.speed;

    // ---- sparks -------------------------------------------------------------
    const onKerb = Math.abs(state.lateral) > projectedTrack.halfWidth && Math.abs(state.lateral) < 8.2
      && kerbAt(state.fraction, Math.sign(state.lateral) || 1);
    // Skid blocks touch at speed (compressions, bumps) and on every kerb.
    let sparkRate = 0;
    if (racing && speed > 58) sparkRate += (speed - 58) * 2.2 * (0.5 + 0.5 * Math.sin(state.elapsed * 3.1 + Math.sin(state.elapsed * 1.7) * 2) > 0.55 ? 1 : 0.08);
    if (racing && onKerb && speed > 20) sparkRate += 90;
    if (lite) sparkRate *= 0.5;
    let toSpawn = sparkRate * dt + Math.random();
    for (const p of sparks.particles) {
      if (p.age >= p.life && toSpawn >= 1) {
        toSpawn -= 1;
        const back = 1.0 + Math.random() * 0.9;
        const across = (Math.random() - 0.5) * 0.9;
        p.x = car.x - fx * back + nx * across;
        p.z = car.z - fz * back + nz * across;
        p.y = surfaceY + 0.03;
        // Thrown back off the floor: slower than the car, fanned out, a little up.
        const keep = 0.55 + Math.random() * 0.25;
        const fan = (Math.random() - 0.5) * 7;
        p.vx = fx * speed * keep + nx * fan;
        p.vz = fz * speed * keep + nz * fan;
        p.vy = 0.6 + Math.random() * 2.4;
        p.life = 0.18 + Math.random() * 0.32;
        p.age = 0;
      }
    }
    const sparkPositions = sparks.lines.geometry.getAttribute('position') as BufferAttribute;
    const sparkColours = sparks.lines.geometry.getAttribute('color') as BufferAttribute;
    sparks.particles.forEach((p, index) => {
      const alive = p.age < p.life;
      if (alive) {
        p.age += dt;
        p.vy -= GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < surfaceY + 0.01) { p.y = surfaceY + 0.01; p.vy = Math.abs(p.vy) * 0.3; }
      }
      const fade = alive ? 1 - p.age / p.life : 0;
      // White-hot, cooling through yellow to orange.
      sparkColour.setRGB(2.6 * fade, (1.7 - 0.9 * (1 - fade)) * fade, (1.1 - 1.0 * (1 - fade)) * fade);
      const tail = 0.022;
      sparkPositions.setXYZ(index * 2, p.x, alive ? p.y : -1000, p.z);
      sparkPositions.setXYZ(index * 2 + 1, p.x - p.vx * tail, alive ? p.y - p.vy * tail : -1000, p.z - p.vz * tail);
      sparkColours.setXYZ(index * 2, sparkColour.r, sparkColour.g, sparkColour.b);
      sparkColours.setXYZ(index * 2 + 1, sparkColour.r * 0.2, sparkColour.g * 0.12, sparkColour.b * 0.05);
    });
    sparkPositions.needsUpdate = true;
    sparkColours.needsUpdate = true;

    // ---- dust ---------------------------------------------------------------
    const offRoad = racing && !state.onTrack && speed > 6;
    let dustToSpawn = (offRoad ? Math.min(60, speed * 1.4) : 0) * dt + Math.random() * (offRoad ? 1 : 0);
    for (const p of dust.particles) {
      if (p.age >= p.life && dustToSpawn >= 1) {
        dustToSpawn -= 1;
        const wheel = Math.random() < 0.5 ? -0.8 : 0.8;
        p.x = car.x - fx * 1.9 + nx * wheel;
        p.z = car.z - fz * 1.9 + nz * wheel;
        p.y = surfaceY + 0.3;
        p.vx = fx * speed * 0.25 + (Math.random() - 0.5) * 3;
        p.vz = fz * speed * 0.25 + (Math.random() - 0.5) * 3;
        p.vy = 0.8 + Math.random() * 1.6;
        p.life = 1.2 + Math.random() * 1.2;
        p.age = 0;
      }
    }
    const dustPositions = dust.points.geometry.getAttribute('position') as BufferAttribute;
    const dustColours = dust.points.geometry.getAttribute('color') as BufferAttribute;
    dust.particles.forEach((p, index) => {
      const alive = p.age < p.life;
      if (alive) {
        p.age += dt;
        const drag = Math.exp(-dt * 2.2);
        p.vx *= drag;
        p.vz *= drag;
        p.vy = p.vy * drag - 0.4 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
      }
      const fade = alive ? Math.sin(Math.PI * Math.min(1, p.age / p.life)) : 0;
      dustPositions.setXYZ(index, p.x, alive ? p.y : -1000, p.z);
      dustColours.setXYZW(index, dustColour.r, dustColour.g, dustColour.b, fade);
    });
    dustPositions.needsUpdate = true;
    dustColours.needsUpdate = true;
  });

  return (
    <>
      <primitive object={sparks.lines} />
      <primitive object={sparks.glow} />
      <primitive object={dust.points} />
    </>
  );
}
