/**
 * The sound of a 2026 Formula 1 power unit, modelled rather than played.
 *
 * A 1.6 L, 90° turbocharged V6 with a crankshaft-geared MGU-K, heard from the
 * onboard camera above the airbox (intake roar and exhaust) or from outside
 * (mostly exhaust). Nothing here is an oscillator holding a note:
 *
 * - The crankshaft turns. Each of the six cylinders fires once every two
 *   revolutions, one every 120° of crank, so the firing frequency is rpm / 20.
 *   Every firing releases an exhaust blowdown pulse, and later draws an intake
 *   suction pulse, whose widths are set in crank degrees: they sharpen as the
 *   revs rise, and they are sharp and strong under load, soft on the overrun.
 * - No two cylinders are quite alike (pulse strength, timing, primary pipe
 *   length) and no two cycles are identical. Those irregularities put energy
 *   at the half and crank orders between the firing harmonics, which is most
 *   of the difference between an engine and a buzz.
 * - The pulses travel through delay-line waveguides with lossy reflections:
 *   six unequal primaries, two bank collectors, the turbine, and an open
 *   tailpipe (an F1 car has no silencer). The intake side has its runners, the
 *   plenum and the airbox snorkel. Their resonances stay put while the pitch
 *   moves, as a real car's do.
 * - Around that: upshift ignition cuts with a crack, downshift blips, overrun
 *   afterfire, a rev limiter, turbo whistle and wastegate, MGU-K whine,
 *   straight-cut gear whine and valvetrain ticking.
 *
 * Plain TypeScript with no DOM: the AudioWorklet wraps it, the main thread can
 * run it in a ScriptProcessor fallback, and Node renders it in the tests.
 */

export interface EngineDspInput {
  /** Normalised engine speed as the game reports it: 0.12 idle, ~0.35 after an upshift, 0.98 at the shift point. */
  rpm: number;
  gear: number;
  /** 0..1. */
  throttle: number;
  /** 0..1. */
  brake: number;
  /** Road speed, m/s. */
  speed: number;
  /** Frequency multiplier, for a car heard from outside (Doppler). */
  pitch?: number;
}

/** 'onboard': the player's car from the camera above the airbox. 'exterior': another car, heard from outside. */
export type EnginePerspective = 'onboard' | 'exterior';

export interface EngineDspOptions {
  /** Seeds the per-cylinder differences and the cycle-to-cycle variation, so two cars never sound identical. */
  seed?: number;
  perspective?: EnginePerspective;
}

export const IDLE_RPM = 4_000;
/** Engine speed just after an upshift (normalised 0.35). */
export const LOW_RPM = 9_500;
/** Engine speed at the shift point (normalised 0.98). */
export const SHIFT_RPM = 12_200;

/** Real engine speed for the game's normalised rpm: idle at 0.12, the post-shift drop at 0.35, the shift point at 0.98. */
export function rpmFromNormalised(value: number): number {
  const n = Number.isFinite(value) ? Math.min(1.02, value) : 0.12;
  if (n <= 0.12) return IDLE_RPM;
  if (n <= 0.35) return IDLE_RPM + ((n - 0.12) / 0.23) * (LOW_RPM - IDLE_RPM);
  return LOW_RPM + ((n - 0.35) / 0.63) * (SHIFT_RPM - LOW_RPM);
}

/** Six cylinders, four strokes: a firing every 120° of crank. */
export function firingHz(rpm: number): number {
  return rpm / 20;
}

const TAU = Math.PI * 2;
const CYLINDERS = 6;
/** Shapes, decay factors and the slower layers are recomputed this often (samples). */
const SUB_BLOCK = 32;

// Valve events, in fractions of the 720° cycle after the cylinder's firing TDC.
const EXHAUST_OPENS = 130 / 720;
const EXHAUST_CLOSES = 375 / 720;
const INTAKE_DRAWS = 372 / 720;
const INTAKE_CLOSES = 590 / 720;

/** Primary pipe lengths (m), in firing order: unequal, as packaging makes them. */
const PRIMARY_METRES = [0.49, 0.505, 0.515, 0.485, 0.5, 0.52];
/** Speed of sound in the hot exhaust (~1,000 K) and in the cooler gas after the turbine, m/s. */
const HOT_GAS = 640;
const TAIL_GAS = 560;
const AIR = 348;

const LIMITER_HZ = 16;
/** Fraction of each limiter period with the ignition cut. */
const LIMITER_CUT = 0.42;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Peak of e^(-x/decay) - e^(-x/rise), to normalise a two-exponential pulse to 1. */
function biexpPeak(rise: number, decay: number): number {
  const r = Math.min(rise, decay * 0.9);
  const at = (Math.log(decay / r) * r * decay) / (decay - r);
  return Math.exp(-at / decay) - Math.exp(-at / r);
}

/** xorshift32: fast, seedable, good enough for noise and variation. */
class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed | 0 || 0x2545f491;
  }
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x;
    return (x >>> 0) / 4294967296;
  }
  bipolar(): number {
    return this.next() * 2 - 1;
  }
  /** Roughly unit-variance, bounded to ±3. */
  gauss(): number {
    return (this.next() + this.next() + this.next() - 1.5) * 2;
  }
}

type BiquadKind = 'lowpass' | 'highpass' | 'bandpass' | 'peak' | 'lowshelf' | 'highshelf';

/** RBJ cookbook biquad, transposed direct form II. */
class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(kind: BiquadKind, sampleRate: number, frequency: number, q = Math.SQRT1_2, gainDb = 0) {
    this.set(kind, sampleRate, frequency, q, gainDb);
  }

  set(kind: BiquadKind, sampleRate: number, frequency: number, q = Math.SQRT1_2, gainDb = 0): void {
    const w0 = (TAU * Math.min(frequency, sampleRate * 0.45)) / sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const a = Math.pow(10, gainDb / 40);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    switch (kind) {
      case 'lowpass':
        b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      case 'bandpass':
        b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
        break;
      case 'peak':
        b0 = 1 + alpha * a; b1 = -2 * cos; b2 = 1 - alpha * a; a0 = 1 + alpha / a; a1 = -2 * cos; a2 = 1 - alpha / a;
        break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(a) * alpha;
        b0 = a * (a + 1 - (a - 1) * cos + s); b1 = 2 * a * (a - 1 - (a + 1) * cos); b2 = a * (a + 1 - (a - 1) * cos - s);
        a0 = a + 1 + (a - 1) * cos + s; a1 = -2 * (a - 1 + (a + 1) * cos); a2 = a + 1 + (a - 1) * cos - s;
        break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(a) * alpha;
        b0 = a * (a + 1 + (a - 1) * cos + s); b1 = -2 * a * (a - 1 + (a + 1) * cos); b2 = a * (a + 1 + (a - 1) * cos - s);
        a0 = a + 1 - (a - 1) * cos + s; a1 = 2 * (a - 1 - (a + 1) * cos); a2 = a + 1 - (a - 1) * cos - s;
        break;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  tick(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/**
 * A pipe as a waveguide. A wave entering at the near end reaches the far end
 * after `oneWay` samples, where part of it leaves (the output) and part
 * reflects; it comes back, reflects again at the near end and joins the next
 * input. Both reflections fold into one loop gain, the losses (wall friction,
 * radiation at the open end) into a one-pole lowpass inside the loop. A
 * negative loop gain is a pipe whose ends reflect with opposite signs: it
 * rings at odd multiples of a quarter wavelength.
 */
class Pipe {
  private readonly buffer: Float64Array;
  private readonly mask: number;
  private readonly oneWay: number;
  private readonly roundTrip: number;
  private readonly gain: number;
  private readonly loss: number;
  private write = 0;
  private lowpassed = 0;

  constructor(sampleRate: number, metres: number, soundSpeed: number, loopGain: number, lossHz: number) {
    this.oneWay = Math.max(1, Math.round((metres / soundSpeed) * sampleRate));
    this.roundTrip = this.oneWay * 2;
    let size = 1;
    while (size < this.roundTrip + 2) size <<= 1;
    this.buffer = new Float64Array(size);
    this.mask = size - 1;
    this.gain = Math.max(-0.95, Math.min(0.95, loopGain));
    this.loss = 1 - Math.exp((-TAU * lossHz) / sampleRate);
  }

  tick(input: number): number {
    const buffer = this.buffer;
    const back = buffer[(this.write - this.roundTrip) & this.mask];
    this.lowpassed += this.loss * (back - this.lowpassed);
    buffer[this.write] = input + this.gain * this.lowpassed;
    const out = buffer[(this.write - this.oneWay) & this.mask];
    this.write = (this.write + 1) & this.mask;
    return out;
  }
}

/** Indices into `stems`: the last sample of each layer, before the master stage. For analysis only. */
export const STEM = { exhaust: 0, intake: 1, mechanical: 2, turbo: 3, electric: 4, pops: 5 } as const;

export class EngineDsp {
  readonly sampleRate: number;
  readonly perspective: EnginePerspective;
  /** Current engine speed, rpm (after shifts, blips and the limiter). */
  rpm = IDLE_RPM;
  /** Turbo shaft speed, 0..1. */
  turbo = 0;
  /** Last output sample of each layer (see STEM). */
  readonly stems = new Float64Array(6);

  private readonly rng: Rng;
  private readonly noise: Rng;

  // Latest input.
  private targetRpm = IDLE_RPM;
  private normalised = 0.12;
  private gear = 1;
  private throttle = 0;
  private brake = 0;
  private speed = 0;
  private pitch = 1;
  private started = false;

  // Engine state.
  private load = 0;
  private loadSlow = 0;
  private gate = 1;
  /** Crank position in cycles (720°), unwrapped. */
  private position = 0;
  private cutLeft = 0;
  private blipLeft = 0;
  private fastLeft = 0;
  private pinnedSeconds = 0;
  private limiterOn = false;
  private limiterPhase = 0;
  private limiterRate = LIMITER_HZ;
  private crackle = 0;
  private lifted = true;
  private pssh = 0;
  private clunk = 0;

  // Per-sample coefficients, refreshed every sub-block.
  private readonly kLoadUp: number;
  private readonly kLoadDown: number;
  private readonly kGate: number;
  private readonly kRpm: number;
  private readonly kRpmFast: number;
  private blowDecay = 0;
  private blowRise = 0;
  private blowNorm = 1;
  private pushDecay = 0;
  private pushRise = 0;
  private pushNorm = 1;
  private drawDecay = 0;
  private drawRise = 0;
  private drawNorm = 1;
  private slapDecay = 0;
  private slapRise = 0;
  private slapNorm = 1;
  private wastegate = 0.1;
  private whistleHz = 1600;
  private whistleLevel = 0;
  private whineHz = 1000;
  private whineLevel = 0;
  private gearHz = 0;
  private gearLevel = 0;
  private jetLevel = 0;
  private drawNoise = 0;

  // Per-cylinder character and pulse state.
  private readonly cylinderGain = new Float64Array(CYLINDERS);
  private readonly cylinderOffset = new Float64Array(CYLINDERS);
  private readonly nominal = new Float64Array(CYLINDERS * 4);
  private readonly next = new Float64Array(CYLINDERS * 4);
  private soonest = 0;
  private readonly blowD = new Float64Array(CYLINDERS);
  private readonly blowR = new Float64Array(CYLINDERS);
  private readonly pushD = new Float64Array(CYLINDERS);
  private readonly pushR = new Float64Array(CYLINDERS);
  private readonly drawD = new Float64Array(CYLINDERS);
  private readonly drawR = new Float64Array(CYLINDERS);
  private readonly slapD = new Float64Array(CYLINDERS);
  private readonly slapR = new Float64Array(CYLINDERS);

  // Exhaust.
  private readonly primaries: Pipe[];
  private readonly collectorA: Pipe;
  private readonly collectorB: Pipe;
  private readonly tailpipe: Pipe;
  private readonly kTurbine: number;
  private turbine = 0;
  private lastTail = 0;
  private jetEnvelope = 0;
  private readonly kJet: number;
  private readonly jetBand: Biquad;

  // Afterfire pops and the shift crack.
  private popEnvelope = 0;
  private popDecay = 0;
  private thumpD = 0;
  private thumpR = 0;
  private readonly kThumpD: number;
  private readonly kThumpR: number;
  private readonly crackFilter: Biquad;

  // Intake.
  private readonly runner: Pipe;
  private readonly plenum: Biquad;
  private readonly snorkel: Pipe;
  private lastSnorkel = 0;
  private readonly drawBand: Biquad;

  // Mechanical and electrical.
  private valveClick = 0;
  private readonly kClick: number;
  private readonly clickFilter: Biquad;
  private readonly kClunk: number;
  private readonly clunkFilter: Biquad;
  private whistlePhase = 0;
  private readonly whistleBand: Biquad;
  private readonly psshBand: Biquad;
  private readonly kPssh: number;
  private whinePhase = 0;
  private gearPhase = 0;
  private gearWobble = 0;

  // Master.
  private readonly lowShelf: Biquad;
  private readonly presence: Biquad;
  private readonly air: Biquad;
  private dcIn = 0;
  private dcOut = 0;
  private readonly kDc: number;
  private readonly mix: { exhaust: number; intake: number; mechanical: number; turbo: number; electric: number; crack: number };

  constructor(sampleRate: number, options: EngineDspOptions = {}) {
    const fs = sampleRate;
    this.sampleRate = fs;
    this.perspective = options.perspective ?? 'onboard';
    const seed = options.seed ?? 1;
    this.rng = new Rng(seed * 2654435761);
    this.noise = new Rng(seed * 40503 + 17);

    const timeK = (seconds: number) => 1 - Math.exp(-1 / (seconds * fs));
    this.kLoadUp = timeK(0.012);
    this.kLoadDown = timeK(0.02);
    this.kGate = timeK(0.0015);
    this.kRpm = timeK(0.03);
    this.kRpmFast = timeK(0.009);
    this.kJet = timeK(0.0004);
    this.kClick = Math.exp(-1 / (0.00035 * fs));
    this.kClunk = Math.exp(-1 / (0.006 * fs));
    this.kPssh = Math.exp(-1 / (0.32 * fs));
    this.kThumpD = Math.exp(-1 / (0.0016 * fs));
    this.kThumpR = Math.exp(-1 / (0.00012 * fs));

    // Every car is a little different.
    for (let cylinder = 0; cylinder < CYLINDERS; cylinder += 1) {
      this.cylinderGain[cylinder] = 1 + 0.08 * this.rng.gauss();
      this.cylinderOffset[cylinder] = (1.6 / 720) * this.rng.gauss();
    }
    const offsets = [EXHAUST_OPENS, INTAKE_DRAWS, EXHAUST_CLOSES, INTAKE_CLOSES];
    for (let cylinder = 0; cylinder < CYLINDERS; cylinder += 1) {
      for (let event = 0; event < 4; event += 1) {
        const index = cylinder * 4 + event;
        this.nominal[index] = cylinder / CYLINDERS + offsets[event] + this.cylinderOffset[cylinder];
        this.next[index] = this.nominal[index];
      }
    }
    this.soonest = Math.min(...this.next);

    const stretch = 1 + 0.04 * this.rng.bipolar();
    this.primaries = PRIMARY_METRES.map((metres) => new Pipe(fs, metres * stretch, HOT_GAS, -0.42, 5000));
    this.collectorA = new Pipe(fs, 0.32, HOT_GAS - 20, -0.25, 5500);
    this.collectorB = new Pipe(fs, 0.325, HOT_GAS - 20, -0.25, 5500);
    this.kTurbine = 1 - Math.exp((-TAU * 3200) / fs);
    this.tailpipe = new Pipe(fs, 0.5, TAIL_GAS, -0.45, 4200);
    this.jetBand = new Biquad('bandpass', fs, 2000, 0.9);
    this.crackFilter = new Biquad('highpass', fs, 380, 0.7);

    this.runner = new Pipe(fs, 0.24, AIR, -0.55, 5000);
    this.plenum = new Biquad('bandpass', fs, 120, 1.2);
    this.snorkel = new Pipe(fs, 0.85, AIR - 3, 0.35, 3000);
    this.drawBand = new Biquad('bandpass', fs, 1800, 0.5);

    this.clickFilter = new Biquad('bandpass', fs, 4500, 1.2);
    this.clunkFilter = new Biquad('lowpass', fs, 1100, 0.9);
    this.whistleBand = new Biquad('bandpass', fs, 3000, 25);
    this.psshBand = new Biquad('bandpass', fs, 4200, 0.8);

    const onboard = this.perspective === 'onboard';
    this.lowShelf = new Biquad('lowshelf', fs, 140, Math.SQRT1_2, onboard ? 4 : 3);
    // Presence where the rasp lives; above it the camera microphone and its wind shield roll off.
    this.presence = new Biquad('peak', fs, 2400, 0.9, onboard ? 3 : 0);
    this.air = new Biquad('lowpass', fs, onboard ? 9000 : 6000, 0.7);
    this.kDc = Math.exp((-TAU * 25) / fs);
    this.mix = onboard
      ? { exhaust: 1, intake: 0.32, mechanical: 1, turbo: 1, electric: 1, crack: 1 }
      : { exhaust: 1.25, intake: 0.15, mechanical: 0.25, turbo: 0.5, electric: 0.3, crack: 1.2 };
    this.control(0);
  }

  /** The car's state this frame. Shifts are detected here: the game reports only the gear and rpm. */
  setInput(input: EngineDspInput): void {
    const target = rpmFromNormalised(input.rpm);
    const gear = Math.round(Number.isFinite(input.gear) ? input.gear : 1);
    if (this.started) {
      if (gear > this.gear && target < this.rpm - 300) this.upshift();
      else if (gear < this.gear && target > this.rpm + 300) this.downshift();
    } else {
      this.rpm = target;
      this.started = true;
    }
    this.gear = gear;
    this.targetRpm = target;
    this.normalised = Number.isFinite(input.rpm) ? input.rpm : 0.12;
    this.throttle = clamp01(Number.isFinite(input.throttle) ? input.throttle : 0);
    this.brake = clamp01(Number.isFinite(input.brake) ? input.brake : 0);
    this.speed = Number.isFinite(input.speed) ? Math.abs(input.speed) : 0;
    const pitch = input.pitch ?? 1;
    this.pitch = Number.isFinite(pitch) ? Math.max(0.5, Math.min(2, pitch)) : 1;
  }

  /** Fills `out[offset .. offset + length)` with the engine, mono, roughly ±0.8 at full song. */
  process(out: Float32Array, offset = 0, length = out.length - offset): void {
    let index = offset;
    const end = offset + length;
    while (index < end) {
      const count = Math.min(SUB_BLOCK, end - index);
      this.control(count);
      for (let step = 0; step < count; step += 1) out[index + step] = this.sample();
      index += count;
    }
  }

  private upshift(): void {
    const fs = this.sampleRate;
    // Ignition cut while the gearbox swaps ratios and the clutchless shift drags the revs down.
    this.cutLeft = Math.round((0.04 + 0.012 * this.rng.next()) * fs);
    this.fastLeft = this.cutLeft + Math.round(0.008 * fs);
    // Unburnt charge lighting in the hot exhaust: the crack between gears.
    this.pop(0.3 + 0.3 * this.load, 0.002 + 0.004 * this.rng.next());
    this.clunk = Math.max(this.clunk, 0.8);
  }

  private downshift(): void {
    const fs = this.sampleRate;
    // The blip: the engine is spun up to meet the lower gear.
    this.blipLeft = Math.round((0.06 + 0.02 * this.rng.next()) * fs);
    this.fastLeft = Math.round(0.05 * fs);
    this.crackle = Math.min(1.3, this.crackle + 0.55);
    this.clunk = Math.max(this.clunk, 0.6);
  }

  private pop(amplitude: number, seconds: number): void {
    this.popEnvelope += amplitude;
    this.popDecay = Math.exp(-1 / (seconds * this.sampleRate));
    this.thumpD += amplitude;
    this.thumpR += amplitude;
  }

  /** Once per sub-block: pulse shapes from rpm and load, and the slow layers. */
  private control(count: number): void {
    const fs = this.sampleRate;
    const dt = count / fs;
    const load = this.load;
    const lean = 1 - load;
    const degrees = (6 * this.rpm * this.pitch) / fs;
    const minRise = degrees * 1.3;

    // Blowdown: sharp and strong under load, slow and soft on the overrun.
    const rise = Math.max(minRise, 1.5 + 3.5 * lean);
    const decay = 15 + 10 * lean;
    this.blowDecay = Math.exp(-degrees / decay);
    this.blowRise = Math.exp(-degrees / rise);
    this.blowNorm = 1 / biexpPeak(rise, decay);
    // Displacement: the piston pushing the rest of the charge out.
    this.pushDecay = Math.exp(-degrees / 80);
    this.pushRise = Math.exp(-degrees / 30);
    this.pushNorm = 1 / biexpPeak(30, 80);
    // Intake suction, and the slap of the intake valve closing.
    this.drawDecay = Math.exp(-degrees / 36);
    this.drawRise = Math.exp(-degrees / 7);
    this.drawNorm = 1 / biexpPeak(7, 36);
    const slapRise = Math.max(minRise, 2.5);
    this.slapDecay = Math.exp(-degrees / 11);
    this.slapRise = Math.exp(-degrees / slapRise);
    this.slapNorm = 1 / biexpPeak(slapRise, 11);

    // Lift-off: afterfire energy and the wastegate dump.
    this.loadSlow += (load - this.loadSlow) * (1 - Math.exp(-dt / 0.15));
    if (!this.lifted && load < 0.2 && this.loadSlow > 0.45 && this.rpm > 8000) {
      this.lifted = true;
      this.crackle = Math.min(1.3, this.crackle + 0.35 + 0.6 * clamp01((this.rpm - 8000) / 4200));
      if (this.turbo > 0.3) this.pssh = Math.max(this.pssh, this.turbo);
    }
    if (load > 0.5) this.lifted = false;
    this.crackle *= Math.exp(-dt / (load < 0.3 ? 0.9 : 0.15));

    // Turbo: spools with exhaust energy, slower to run down than to spin up.
    const spool = clamp01((this.rpm - 5500) / 6500);
    const turboTarget = Math.pow(spool, 1.3) * (0.15 + 0.85 * load);
    this.turbo += (turboTarget - this.turbo) * (1 - Math.exp(-dt / (turboTarget > this.turbo ? 0.45 : 1.4)));
    this.wastegate = 0.12 + 0.35 * clamp01((this.turbo - 0.7) / 0.3) * load + 0.3 * clamp01(this.pssh);
    this.whistleHz = 1600 + 5400 * this.turbo;
    this.whistleLevel = this.turbo * this.turbo * (0.3 + 0.7 * load);
    this.whistleBand.set('bandpass', fs, this.whistleHz, 25);

    // MGU-K: geared to the crank, whining while it deploys and, louder, while it harvests.
    const moving = clamp01(this.speed / 12);
    const deploy = load * moving;
    const harvest = (this.brake + 0.3 * lean) * moving;
    this.whineHz = (this.rpm * this.pitch * 16) / 60;
    this.whineLevel = (0.45 * deploy + 0.8 * harvest) * (0.4 + 0.6 * clamp01(this.speed / 80));
    // Straight-cut final drive, tied to road speed.
    this.gearHz = 21 * this.speed * this.pitch;
    this.gearLevel = moving * (0.35 + 0.65 * load);

    this.jetLevel = 0.35 + 0.65 * load;
    this.drawNoise = 0.25 + 0.75 * load;

    // The rev limiter: on the grid with the throttle pinned, or flat out at the top of the last gear.
    const pinned = this.throttle > 0.6 && (this.normalised >= 0.975 || (this.speed < 0.5 && this.normalised >= 0.9));
    this.pinnedSeconds = pinned && Math.abs(this.rpm - this.targetRpm) < 450 ? this.pinnedSeconds + dt : 0;
    this.limiterOn = this.pinnedSeconds > 0.18;
  }

  private sample(): number {
    const fs = this.sampleRate;
    const rng = this.rng;
    const noise = this.noise;

    // ---- Driver and ECU ------------------------------------------------
    let loadTarget = this.throttle;
    if (this.blipLeft > 0) {
      this.blipLeft -= 1;
      loadTarget = Math.max(loadTarget, 0.9);
    }
    this.load += (loadTarget - this.load) * (loadTarget > this.load ? this.kLoadUp : this.kLoadDown);

    let gateTarget = 1;
    let desired = this.targetRpm;
    let k = this.kRpm;
    let free = false;
    if (this.cutLeft > 0) {
      this.cutLeft -= 1;
      gateTarget = 0.03;
    }
    if (this.limiterOn) {
      this.limiterPhase += this.limiterRate / fs;
      if (this.limiterPhase >= 1) {
        this.limiterPhase -= 1;
        this.limiterRate = LIMITER_HZ * (0.9 + 0.2 * rng.next());
        if (rng.next() < 0.45) this.pop(0.25 + 0.3 * rng.next(), 0.003);
      }
      const cut = this.limiterPhase < LIMITER_CUT;
      if (cut) gateTarget = 0;
      desired = this.targetRpm + (cut ? -320 : 60);
      k = this.kRpmFast;
      free = true;
    }
    if (this.fastLeft > 0) {
      this.fastLeft -= 1;
      k = this.kRpmFast;
      free = true;
    }
    this.gate += (gateTarget - this.gate) * this.kGate;

    // ---- Crankshaft ----------------------------------------------------
    let change = (desired - this.rpm) * k;
    if (!free) {
      // Inertia: a free-revving F1 engine climbs fast and falls a little slower.
      const up = (9000 + 26000 * this.load) / fs;
      const down = 16000 / fs;
      if (change > up) change = up;
      else if (change < -down) change = -down;
    }
    this.rpm += change;
    const increment = (this.rpm * this.pitch) / 120 / fs;
    this.position += increment;
    if (this.position >= this.soonest) this.fireEvents(increment);

    // ---- Exhaust -------------------------------------------------------
    let bankA = 0;
    let bankB = 0;
    let blow = 0;
    const blowD = this.blowD, blowR = this.blowR, pushD = this.pushD, pushR = this.pushR;
    for (let cylinder = 0; cylinder < CYLINDERS; cylinder += 1) {
      blowD[cylinder] *= this.blowDecay;
      blowR[cylinder] *= this.blowRise;
      pushD[cylinder] *= this.pushDecay;
      pushR[cylinder] *= this.pushRise;
      const blowdown = blowD[cylinder] - blowR[cylinder];
      blow += blowdown;
      const leaving = this.primaries[cylinder].tick(blowdown + pushD[cylinder] - pushR[cylinder]);
      if (cylinder & 1) bankB += leaving;
      else bankA += leaving;
    }
    const merged = this.collectorA.tick(bankA) + this.collectorB.tick(bankB);
    // The turbine soaks up the sharpest edges and energy; the wastegate lets some past untouched.
    this.turbine += this.kTurbine * (merged - this.turbine);
    const turbineOut = this.turbine * 0.72 * (1 - this.wastegate) + merged * this.wastegate;

    // Afterfire pops: a sharp thump through the tailpipe and a broadband crack.
    this.popEnvelope *= this.popDecay;
    this.thumpD *= this.kThumpD;
    this.thumpR *= this.kThumpR;
    const crackNoise = this.popEnvelope > 1e-5 ? noise.bipolar() * this.popEnvelope : 0;
    const thump = (this.thumpD - this.thumpR) * 1.6;

    const tail = this.tailpipe.tick(turbineOut + thump + crackNoise * 0.35);
    // An open pipe end radiates the rate of change of flow: a gentle high-frequency lift.
    const radiated = tail - 0.45 * this.lastTail;
    this.lastTail = tail;
    // Turbulent jet noise, riding each pulse: the rasp.
    this.jetEnvelope += this.kJet * (Math.abs(blow) - this.jetEnvelope);
    const jet = this.jetBand.tick(noise.bipolar()) * this.jetEnvelope * this.jetLevel;
    const crack = crackNoise !== 0 ? this.crackFilter.tick(crackNoise) : 0;
    const exhaust = radiated * 0.55 + jet * 0.7;

    // ---- Intake --------------------------------------------------------
    let draw = 0;
    let slap = 0;
    const drawD = this.drawD, drawR = this.drawR, slapD = this.slapD, slapR = this.slapR;
    for (let cylinder = 0; cylinder < CYLINDERS; cylinder += 1) {
      drawD[cylinder] *= this.drawDecay;
      drawR[cylinder] *= this.drawRise;
      slapD[cylinder] *= this.slapDecay;
      slapR[cylinder] *= this.slapRise;
      draw += drawD[cylinder] - drawR[cylinder];
      slap += slapD[cylinder] - slapR[cylinder];
    }
    const rush = this.drawBand.tick(noise.bipolar()) * draw * this.drawNoise;
    const atValve = -draw + slap + rush * 0.8;
    const runner = this.runner.tick(atValve);
    const plenum = runner * 0.8 + this.plenum.tick(runner) * 0.9;
    const snorkel = this.snorkel.tick(plenum);
    const intake = (snorkel - 0.5 * this.lastSnorkel) * 0.5;
    this.lastSnorkel = snorkel;

    // ---- Mechanical ----------------------------------------------------
    this.valveClick *= this.kClick;
    this.clunk *= this.kClunk;
    const valvetrain = this.clickFilter.tick(noise.bipolar() * this.valveClick);
    const clunk = this.clunk > 1e-5 ? this.clunkFilter.tick(noise.bipolar() * this.clunk) : 0;
    let gearWhine = 0;
    if (this.gearLevel > 1e-4) {
      this.gearWobble += 0.002 * (noise.bipolar() - this.gearWobble);
      this.gearPhase += this.gearHz / fs;
      if (this.gearPhase >= 1) this.gearPhase -= 1;
      gearWhine = Math.sin(TAU * this.gearPhase) * this.gearLevel * (1 + 6 * this.gearWobble);
    }
    const mechanical = valvetrain * 0.06 + clunk * 0.35 + gearWhine * 0.0035;

    // ---- Turbo ---------------------------------------------------------
    let whistle = 0;
    if (this.whistleLevel > 1e-4) {
      this.whistlePhase += this.whistleHz / fs;
      if (this.whistlePhase >= 1) this.whistlePhase -= 1;
      const whistleNoise = this.whistleBand.tick(noise.bipolar());
      whistle = (Math.sin(TAU * this.whistlePhase) * 0.55 + whistleNoise * 2.2) * this.whistleLevel;
    }
    this.pssh *= this.kPssh;
    const dump = this.pssh > 1e-4 ? this.psshBand.tick(noise.bipolar()) * this.pssh : 0;
    const turbo = whistle * 0.01 + dump * 0.05;

    // ---- MGU-K ---------------------------------------------------------
    let electric = 0;
    if (this.whineLevel > 1e-4) {
      this.whinePhase += this.whineHz / fs;
      if (this.whinePhase >= 1) this.whinePhase -= 1;
      electric = (Math.sin(TAU * this.whinePhase) + 0.3 * Math.sin(2 * TAU * this.whinePhase)) * this.whineLevel * 0.006;
    }

    // ---- Master --------------------------------------------------------
    const mix = this.mix;
    const pops = crack * 0.5;
    let signal = exhaust * mix.exhaust + intake * mix.intake + mechanical * mix.mechanical + turbo * mix.turbo + electric * mix.electric + pops * mix.crack;
    const stems = this.stems;
    stems[0] = exhaust * mix.exhaust;
    stems[1] = intake * mix.intake;
    stems[2] = mechanical * mix.mechanical;
    stems[3] = turbo * mix.turbo;
    stems[4] = electric * mix.electric;
    stems[5] = pops * mix.crack;

    signal = this.lowShelf.tick(signal);
    signal = this.presence.tick(signal);
    signal = this.air.tick(signal);
    // DC blocker.
    const blocked = signal - this.dcIn + this.kDc * this.dcOut;
    this.dcIn = signal;
    this.dcOut = blocked;
    // Gentle saturation, as a microphone and preamp next to an F1 engine give.
    return Math.tanh(blocked * 1.4) * 0.72;
  }

  /** Every valve event the crank has just passed. */
  private fireEvents(increment: number): void {
    const position = this.position;
    const rng = this.rng;
    let soonest = Infinity;
    for (let index = 0; index < CYLINDERS * 4; index += 1) {
      if (position >= this.next[index]) {
        const cylinder = index >> 2;
        const event = index & 3;
        const late = Math.min(1, (position - this.next[index]) / Math.max(1e-9, increment));
        if (event === 0) this.exhaustOpens(cylinder, late);
        else if (event === 1) this.intakeDraws(cylinder, late);
        else if (event === 3) this.intakeCloses(cylinder, late);
        // Valves seating: the pneumatic valvetrain's tick.
        if (event >= 2) this.valveClick = Math.max(this.valveClick, (0.6 + 0.4 * rng.next()) * (event === 2 ? 1 : 0.8));
        this.nominal[index] += 1;
        // Combustion varies cycle to cycle; the valve train hardly at all.
        const spread = event === 0 ? (0.5 + 1.2 * (1 - this.load)) / 720 : 0.2 / 720;
        this.next[index] = this.nominal[index] + spread * rng.gauss();
        // A crank that has fallen far behind (a sudden stop) catches up instead of firing a burst.
        if (this.next[index] < position) {
          this.nominal[index] += Math.ceil(position - this.nominal[index]);
          this.next[index] = this.nominal[index];
        }
      }
      if (this.next[index] < soonest) soonest = this.next[index];
    }
    this.soonest = soonest;
  }

  private exhaustOpens(cylinder: number, late: number): void {
    const rng = this.rng;
    const load = this.load;
    const lean = 1 - load;
    // Firing strength: full under load, a weak motoring pulse on the overrun, nothing during a cut.
    // Cylinders differ more at light load and low revs, where mixture distribution is poorest: a lumpy
    // idle. At high revs on the overrun the fuel is cut and the engine just pumps, evenly.
    const rough = lean * (1 - clamp01((this.rpm - 5000) / 3000));
    let strength = (0.22 + 0.78 * Math.pow(load, 0.8)) * (1 + (this.cylinderGain[cylinder] - 1) * (1 + 2 * rough));
    strength *= 1 + (0.05 + 0.2 * rough * lean) * rng.gauss();
    // Idle combustion is ragged: now and then a cylinder barely fires.
    if (rough > 0.5 && rng.next() < 0.06 * rough) strength *= 0.3;
    strength *= this.gate;
    // On the overrun, unburnt fuel lights in the hot exhaust: crackle.
    if (load < 0.3 && this.crackle > 0.02 && rng.next() < 0.022 * this.crackle * (1 - load / 0.3)) {
      this.pop((0.12 + 0.4 * rng.next()) * Math.min(1, this.crackle), 0.0015 + 0.006 * rng.next());
    }
    // Start the pulse where the event fell inside this sample.
    const blowD = Math.pow(this.blowDecay, late);
    const blowR = Math.pow(this.blowRise, late);
    this.blowD[cylinder] += strength * this.blowNorm * blowD;
    this.blowR[cylinder] += strength * this.blowNorm * blowR;
    const push = strength * 0.3 * this.pushNorm;
    this.pushD[cylinder] += push * Math.pow(this.pushDecay, late);
    this.pushR[cylinder] += push * Math.pow(this.pushRise, late);
  }

  private intakeDraws(cylinder: number, late: number): void {
    // The throttle sets how hard each cylinder breathes.
    const strength = (0.08 + 0.92 * this.load) * (1 + (this.cylinderGain[cylinder] - 1) * 0.7) * (1 + 0.05 * this.rng.gauss());
    const draw = strength * this.drawNorm;
    this.drawD[cylinder] += draw * Math.pow(this.drawDecay, late);
    this.drawR[cylinder] += draw * Math.pow(this.drawRise, late);
  }

  /** The intake valve shutting on a moving column of air: a slap that rings the runner (the ram effect). */
  private intakeCloses(cylinder: number, late: number): void {
    const slap = (0.08 + 0.92 * this.load) * this.cylinderGain[cylinder] * 0.8 * this.slapNorm;
    this.slapD[cylinder] += slap * Math.pow(this.slapDecay, late);
    this.slapR[cylinder] += slap * Math.pow(this.slapRise, late);
  }
}
