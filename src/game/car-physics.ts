/**
 * The player's car. Arcade, but built from the real forces so it behaves the
 * way people expect a fast car to behave: it needs braking for corners, it runs
 * wide if you ask too much of it, and it is slower on the grass.
 *
 * Pure: a state in, a state out. Everything here is unit-testable.
 */
export interface CarState {
  x: number;
  z: number;
  /** Heading in radians; 0 faces +X, increasing turns toward +Z. */
  heading: number;
  /** Forward speed in m/s. */
  speed: number;
  /** Current steering angle in radians, smoothed toward the input. */
  steer: number;
  /** Lateral slip in [0, 1], for tyre audio and the HUD. */
  slip: number;
}

export interface CarInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  /** -1 (left) .. 1 (right). */
  steer: number;
  drs: boolean;
}

export interface CarEnvironment {
  onTrack: boolean;
  /** Whether DRS may be used here (in a zone and close enough to the car ahead). */
  drsAvailable: boolean;
}

export const CAR = {
  mass: 800,
  wheelbase: 3.6,
  engineForce: 14_500,
  brakeForce: 22_000,
  /** Sized so drag alone caps the car near `topSpeed`, as on a real car. */
  dragCoefficient: 2.0,
  rollingResistance: 220,
  /** Radians of lock at rest. */
  maxSteer: 0.6,
  /** Steering lock shrinks toward this fraction at top speed. */
  highSpeedSteerFraction: 0.38,
  /** Base lateral acceleration limit, m/s² (~3 g). */
  baseGrip: 30,
  /** Extra grip per (m/s)², standing in for downforce: ~5.5 g at top speed. */
  downforceGrip: 0.004,
  /** Speed scrubbed by hard cornering, so braking for corners still matters. */
  corneringDrag: 0.9,
  topSpeed: 85, // m/s ≈ 306 km/h
  drsDragFactor: 0.8,
  drsTopSpeed: 92,
  offTrackGripFactor: 0.42,
  offTrackDragFactor: 3.2,
  steerResponse: 12,
} as const;

export function createCarState(x: number, z: number, heading: number): CarState {
  return { x, z, heading, speed: 0, steer: 0, slip: 0 };
}

export function stepCar(state: CarState, input: CarInput, env: CarEnvironment, dt: number): CarState {
  const drs = input.drs && env.drsAvailable && state.speed > 30;
  const topSpeed = drs ? CAR.drsTopSpeed : CAR.topSpeed;

  // ---- longitudinal ------------------------------------------------------
  const v = state.speed;
  let drag = CAR.dragCoefficient * v * v * (drs ? CAR.drsDragFactor : 1);
  if (!env.onTrack) drag *= CAR.offTrackDragFactor;
  const rolling = CAR.rollingResistance * Math.sign(v);
  const engine = CAR.engineForce * Math.max(0, Math.min(1, input.throttle));
  const brake = CAR.brakeForce * Math.max(0, Math.min(1, input.brake)) * Math.sign(v || 1);
  const accel = (engine - drag - rolling - brake) / CAR.mass;
  let speed = v + accel * dt;
  if (Math.sign(speed) !== Math.sign(v) && input.brake > 0 && input.throttle === 0) speed = 0;
  speed = Math.max(-8, Math.min(topSpeed, speed));

  // ---- steering ----------------------------------------------------------
  // Lock shrinks with speed so the car is stable when fast and agile when slow.
  const speedFraction = Math.min(1, Math.abs(speed) / CAR.topSpeed);
  const lock = CAR.maxSteer * (1 - (1 - CAR.highSpeedSteerFraction) * speedFraction);
  const targetSteer = Math.max(-1, Math.min(1, input.steer)) * lock;
  const steer = state.steer + (targetSteer - state.steer) * Math.min(1, CAR.steerResponse * dt);

  // Bicycle model yaw demand, limited by available grip.
  const demandedYaw = (speed / CAR.wheelbase) * Math.tan(steer);
  let grip = CAR.baseGrip + CAR.downforceGrip * speed * speed;
  if (!env.onTrack) grip *= CAR.offTrackGripFactor;
  const maxYaw = Math.abs(speed) > 0.5 ? grip / Math.abs(speed) : Number.POSITIVE_INFINITY;
  const yaw = Math.max(-maxYaw, Math.min(maxYaw, demandedYaw));
  const slip = Math.abs(demandedYaw) > 1e-6 ? Math.min(1, Math.max(0, 1 - Math.abs(yaw) / Math.abs(demandedYaw))) : 0;

  const lateralLoad = Math.abs(yaw) * Math.abs(speed);
  speed = Math.max(0, speed - CAR.corneringDrag * (lateralLoad / Math.max(1, grip)) * Math.abs(speed) * dt * 0.5);

  const heading = state.heading + yaw * dt;
  const x = state.x + Math.cos(heading) * speed * dt;
  const z = state.z + Math.sin(heading) * speed * dt;

  return { x, z, heading, speed, steer, slip };
}

/** Gear and RPM for the HUD and the engine note. */
export function gearFor(speed: number): { gear: number; rpm: number } {
  const v = Math.abs(speed);
  if (v < 0.5) return { gear: 1, rpm: 0.12 };
  const ratios = [0, 14, 26, 38, 50, 61, 71, 80];
  let gear = 1;
  for (let index = 1; index < ratios.length; index += 1) if (v >= ratios[index]) gear = index + 1;
  const low = ratios[gear - 1];
  const high = gear < ratios.length ? ratios[gear] : CAR.drsTopSpeed;
  const rpm = 0.35 + 0.63 * Math.min(1, Math.max(0, (v - low) / Math.max(1, high - low)));
  return { gear, rpm };
}
