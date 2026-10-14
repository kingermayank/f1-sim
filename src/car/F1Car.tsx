import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Color, Group, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Vector3 } from 'three';
import { carGeometry, CAR_DIMENSIONS, STRAIGHT_MODE_FRONT_FLAP, STRAIGHT_MODE_REAR_FLAP, type CarDetail } from './car-geometry';
import {
  COMPOUNDS,
  createCarbonMaterial,
  createPaintMaterial,
  createTyreMaterial,
  glowColour,
  numberTexture,
  setPaint,
  settlePaint,
  type PaintUniforms,
} from './car-materials';
import { CAMERA_POD, type Livery } from './liveries';

/** Live inputs a racing car reads every frame; the showroom passes none. */
export interface CarMotion {
  /** Metres per second, for wheel spin. */
  speed: number;
  /** Steering, -1 (right) to 1 (left). */
  steer: number;
  /** Wings flat for the straight. */
  straight: boolean;
}

export interface F1CarProps {
  livery: Livery;
  number?: number;
  /** Which of the team's two cars: decides the camera pod colour. */
  pod?: 'first' | 'second';
  detail?: CarDetail;
  /** Wings flat (showroom toggle); a racing car reads `motion` instead. */
  straight?: boolean;
  motion?: RefObject<CarMotion | null>;
  compound?: keyof typeof COMPOUNDS;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Rain lights flash (straight mode, energy recovery). */
  flashLights?: boolean;
  /** Exposes the paint uniforms, e.g. for a picture render. */
  paintRef?: RefObject<PaintUniforms | null>;
}

const MAX_STEER = 0.32;
/** Where a livery change starts: the nose tip, so the paint runs front to back. */
const WIPE_ORIGIN = new Vector3(0, 0.25, 2.75);
/** The wipe grows at a constant 3.4 m/s: about 1.6 s from the nose to the rear wing. */
const WIPE_SPEED = 3.4;
/** Extreme points of the car: the wipe is done once it has passed all of them. */
const EXTREMES = [
  new Vector3(0.95, 0.2, 2.8), new Vector3(-0.95, 0.2, 2.8), new Vector3(0.55, 1.0, -2.6),
  new Vector3(-0.55, 1.0, -2.6), new Vector3(0, 0.9, 0), new Vector3(0.95, 0.36, -1.7), new Vector3(-0.95, 0.36, -1.7),
];
const WIPE_END = Math.max(...EXTREMES.map((point) => point.distanceTo(WIPE_ORIGIN))) + 0.1;
/** Parts outside the paint shader change colour as the front passes them. */
const HELMET_AT = new Vector3(0, 0.845, -0.1).distanceTo(WIPE_ORIGIN);
const FRONT_WHEELS_AT = new Vector3(0.8, 0.36, 1.7).distanceTo(WIPE_ORIGIN);
const REAR_WHEELS_AT = new Vector3(0.765, 0.36, -1.7).distanceTo(WIPE_ORIGIN);

function usePrefersReducedMotion() {
  const reduced = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reduced.current = query.matches; };
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

/**
 * The car. Geometry is shared by every car at the same detail level; this
 * component owns only its materials. A livery change does not swap anything:
 * a sphere grows from the nose tip, carrying the new paint, number and
 * finish over the car behind a thin glowing shell.
 */
export function F1Car({
  livery,
  number,
  pod = 'first',
  detail = 'high',
  straight = false,
  motion,
  compound = 'soft',
  castShadow = true,
  receiveShadow = true,
  flashLights = false,
  paintRef,
}: F1CarProps) {
  const geometry = carGeometry(detail);
  const reducedMotion = usePrefersReducedMotion();

  const materials = useMemo(() => {
    const rimMaterial = () => new MeshPhysicalMaterial({ color: livery.rim, metalness: 0.9, roughness: 0.36, clearcoat: 0.4, clearcoatRoughness: 0.2 });
    const nutMaterial = () => new MeshStandardMaterial({ color: livery.accent, metalness: 0.7, roughness: 0.28 });
    const paint = createPaintMaterial(livery);
    return {
      paint,
      paintLite: createPaintMaterial(livery, { uniforms: paint.uniforms, lite: true }).material,
      carbon: createCarbonMaterial(),
      tyreFront: createTyreMaterial(COMPOUNDS[compound], CAR_DIMENSIONS.frontTyreHalfWidth),
      tyreRear: createTyreMaterial(COMPOUNDS[compound], CAR_DIMENSIONS.rearTyreHalfWidth),
      rimFront: rimMaterial(),
      rimRear: rimMaterial(),
      nutFront: nutMaterial(),
      nutRear: nutMaterial(),
      brake: new MeshStandardMaterial({ color: '#232427', metalness: 0.2, roughness: 0.75 }),
      helmet: new MeshPhysicalMaterial({ color: livery.helmet, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.04 }),
      visor: new MeshPhysicalMaterial({ color: '#08090b', metalness: 0.85, roughness: 0.06, iridescence: 1, iridescenceIOR: 1.9, iridescenceThicknessRange: [260, 640] }),
      chrome: new MeshStandardMaterial({ color: '#dfe6ee', metalness: 1, roughness: 0.03 }),
      lights: new MeshBasicMaterial({ color: new Color('#ff1a28').multiplyScalar(3), toneMapped: false }),
    };
    // The props only seed the materials; later changes run as wipes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const uniforms = materials.paint.uniforms;

  useEffect(() => () => {
    materials.paint.material.dispose();
    for (const [key, material] of Object.entries(materials)) {
      if (key !== 'paint') (material as { dispose(): void }).dispose();
    }
  }, [materials]);

  useEffect(() => {
    materials.tyreFront.userData.uniforms.uBand.value.set(COMPOUNDS[compound]);
    materials.tyreRear.userData.uniforms.uBand.value.set(COMPOUNDS[compound]);
  }, [compound, materials]);

  useEffect(() => {
    if (paintRef) (paintRef as { current: PaintUniforms | null }).current = uniforms;
  }, [paintRef, uniforms]);

  // Livery, number or camera-pod changes: paint the car with a wipe.
  const shown = useRef<string | null>(null);
  const wipe = useRef({ running: false, radius: 0, helmet: '', rim: '', accent: '' });
  useEffect(() => {
    const key = `${livery.teamId}|${number ?? ''}|${pod}`;
    if (shown.current === key) return;
    const first = shown.current === null;
    shown.current = key;
    const state = { livery, number: number === undefined ? null : numberTexture(number), cam: CAMERA_POD[pod] };
    const target = wipe.current;
    target.helmet = livery.helmet;
    target.rim = livery.rim;
    target.accent = livery.accent;
    if (first || reducedMotion.current) {
      setPaint(uniforms, state);
      settlePaint(uniforms);
      uniforms.uWipeOn.value = 0;
      target.running = false;
      materials.helmet.color.set(livery.helmet);
      for (const rim of [materials.rimFront, materials.rimRear]) rim.color.set(livery.rim);
      for (const nut of [materials.nutFront, materials.nutRear]) nut.color.set(livery.accent);
      return;
    }
    // Whatever is showing becomes the old paint; a wipe in progress snaps to done.
    settlePaint(uniforms);
    setPaint(uniforms, state);
    glowColour(livery, uniforms.uGlowCol.value);
    uniforms.uWipe.value.set(WIPE_ORIGIN.x, WIPE_ORIGIN.y, WIPE_ORIGIN.z, 0);
    uniforms.uWipeOn.value = 1;
    target.running = true;
    target.radius = 0;
  }, [livery, number, pod, materials, reducedMotion, uniforms]);

  const rearFlap = useRef<Group>(null);
  const frontFlaps = useRef<Group>(null);
  const steer = useRef<(Group | null)[]>([]);
  const spin = useRef<(Group | null)[]>([]);
  const rolled = useRef(0);
  const flapOpen = useRef(0);
  const steerAngle = useRef(0);
  const clock = useRef(0);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    clock.current += delta;
    const state = wipe.current;
    if (state.running) {
      const before = state.radius;
      state.radius += WIPE_SPEED * delta;
      uniforms.uWipe.value.w = state.radius;
      const passed = (at: number) => before < at && state.radius >= at;
      if (passed(FRONT_WHEELS_AT)) { materials.rimFront.color.set(state.rim); materials.nutFront.color.set(state.accent); }
      if (passed(HELMET_AT)) materials.helmet.color.set(state.helmet);
      if (passed(REAR_WHEELS_AT)) { materials.rimRear.color.set(state.rim); materials.nutRear.color.set(state.accent); }
      if (state.radius > WIPE_END) {
        state.running = false;
        uniforms.uWipeOn.value = 0;
      }
    }

    const live = motion?.current;
    const wantOpen = live ? live.straight : straight;
    flapOpen.current += ((wantOpen ? 1 : 0) - flapOpen.current) * (1 - Math.exp(-delta * 9));
    if (rearFlap.current) rearFlap.current.rotation.x = STRAIGHT_MODE_REAR_FLAP * flapOpen.current;
    if (frontFlaps.current) frontFlaps.current.rotation.x = STRAIGHT_MODE_FRONT_FLAP * flapOpen.current;

    // Rain lights: a steady glow, flashing at 4 Hz when the wings are flat or asked to.
    const flashing = flashLights || flapOpen.current > 0.5;
    const level = flashing ? (Math.sin(clock.current * 25) > 0 ? 1 : 0.1) : 0.7;
    materials.lights.color.setRGB(3 * level, 0.3 * level, 0.45 * level);

    if (live) {
      rolled.current = (rolled.current + (live.speed / CAR_DIMENSIONS.tyreRadius) * delta) % (Math.PI * 2);
      steerAngle.current += (live.steer * MAX_STEER - steerAngle.current) * (1 - Math.exp(-delta * 12));
      for (let index = 0; index < 4; index += 1) {
        const spinner = spin.current[index];
        if (spinner) spinner.rotation.x = index % 2 === 0 ? rolled.current : -rolled.current;
        const steerer = steer.current[index];
        if (steerer && index < 2) steerer.rotation.y = steerAngle.current;
      }
    }
  });

  const shadow = { castShadow, receiveShadow };
  return (
    <group name="f1-car" dispose={null}>
      <mesh name="paint" geometry={geometry.paint} material={detail === 'low' ? materials.paintLite : materials.paint.material} {...shadow} />
      <mesh name="carbon" geometry={geometry.carbon} material={materials.carbon} {...shadow} />
      <mesh name="helmet" geometry={geometry.helmet} material={materials.helmet} {...shadow} />
      <mesh name="visor" geometry={geometry.visor} material={materials.visor} />
      <mesh name="mirrors" geometry={geometry.chrome} material={materials.chrome} />
      <mesh name="lights" geometry={geometry.lights} material={materials.lights} />
      <group ref={rearFlap} position={geometry.rearFlapPivot}>
        <mesh geometry={geometry.rearFlap} material={materials.carbon} {...shadow} />
      </group>
      <group ref={frontFlaps} position={geometry.frontFlapPivot}>
        <mesh geometry={geometry.frontFlaps} material={materials.carbon} {...shadow} />
      </group>
      {geometry.wheelCentres.map((centre, index) => {
        const isFront = index < 2;
        const outboardLeft = centre.x > 0;
        const wheel = isFront ? geometry.front : geometry.rear;
        return (
          <group key={index} position={centre} ref={(node) => { steer.current[index] = node; }}>
            <group rotation={[0, outboardLeft ? 0 : Math.PI, 0]}>
              <group ref={(node) => { spin.current[index] = node; }}>
                <mesh geometry={wheel.tyre} material={isFront ? materials.tyreFront : materials.tyreRear} {...shadow} />
                <mesh geometry={wheel.rim} material={isFront ? materials.rimFront : materials.rimRear} castShadow={castShadow} />
                <mesh geometry={wheel.nut} material={isFront ? materials.nutFront : materials.nutRear} />
              </group>
              <mesh geometry={wheel.brake} material={materials.brake} />
            </group>
          </group>
        );
      })}
    </group>
  );
}
