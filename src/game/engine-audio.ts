/**
 * Procedural race audio for the player's car. Everything is synthesised, so
 * there is nothing new to license.
 *
 * The note is built the way a turbo V6 makes it: a firing frequency of three
 * pulses per revolution (about 200 Hz at idle to just under 600 Hz at the
 * limiter), a sub-octave for body, a slightly detuned copy for growl, a soft
 * clip for exhaust rasp, and a resonant low-pass that opens with the throttle.
 * Over that sit a turbo whine, wind, tyre scrub, and the nearest rival's engine
 * panned to the side it is on, with Doppler from the closing rate.
 */
export interface EngineAudioFrame {
  rpm: number;
  gear: number;
  throttle: number;
  brake: number;
  slip: number;
  speed: number;
  onTrack: boolean;
  /** Nearest rival: metres away and -1 (left) .. 1 (right). Null when none is close. */
  rival: { distance: number; pan: number } | null;
}

export interface EngineAudio {
  start(): void;
  update(frame: EngineAudioFrame): void;
  /** Short impact burst for a barrier or car contact. */
  thud(intensity: number): void;
  /** One gantry light coming on (index 0-4), or all going out. */
  light(index: number): void;
  lightsOut(): void;
  /** A rival going past, or being passed: the recorded pass-by if present, panned to its side. */
  passBy(pan: number): void;
  /** Crowd and paddock bed level, 0-1, for the intro and grid. */
  setAmbience(level: number): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

import { loadSfx, type SfxLibrary } from './sfx';

/** Firing frequency at rpm 0 and the range up to the limiter. */
const FIRING_BASE_HZ = 190;
const FIRING_RANGE_HZ = 400;
const MASTER_LEVEL = 0.6;

function noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

function loopingNoise(context: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start();
  return source;
}

function softClipCurve(drive: number): Float32Array<ArrayBuffer> {
  const samples = 512;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let index = 0; index < samples; index += 1) {
    const x = (index / (samples - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}

interface EngineVoice {
  oscillators: OscillatorNode[];
  /** Multiplier of the firing frequency for each oscillator. */
  ratios: number[];
  filter: BiquadFilterNode;
  gain: GainNode;
}

function createVoice(context: AudioContext, destination: AudioNode, shaped: boolean): EngineVoice {
  const mix = context.createGain();
  const specs: { type: OscillatorType; ratio: number; level: number }[] = [
    { type: 'sawtooth', ratio: 1, level: 0.5 },
    { type: 'sawtooth', ratio: 1.006, level: 0.35 },
    { type: 'sawtooth', ratio: 0.5, level: 0.4 },
    { type: 'square', ratio: 2, level: 0.14 },
  ];
  const oscillators = specs.map((spec) => {
    const oscillator = context.createOscillator();
    oscillator.type = spec.type;
    const level = context.createGain();
    level.gain.value = spec.level;
    oscillator.connect(level).connect(mix);
    oscillator.start();
    return oscillator;
  });

  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1200;
  filter.Q.value = 1.4;
  const gain = context.createGain();
  gain.gain.value = 0;

  if (shaped) {
    const shaper = context.createWaveShaper();
    shaper.curve = softClipCurve(2.2);
    shaper.oversample = '2x';
    mix.connect(shaper).connect(filter).connect(gain).connect(destination);
  } else {
    mix.connect(filter).connect(gain).connect(destination);
  }
  return { oscillators, ratios: specs.map((spec) => spec.ratio), filter, gain };
}

export function createEngineAudio(): EngineAudio {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let engine: EngineVoice | null = null;
  let rival: EngineVoice | null = null;
  let rivalPan: StereoPannerNode | null = null;
  let whine: OscillatorNode | null = null;
  let whineGain: GainNode | null = null;
  let intakeGain: GainNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  let windGain: GainNode | null = null;
  let tyreGain: GainNode | null = null;
  let surfaceGain: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let lastGear = 1;
  let shiftUntil = 0;
  let lastRivalDistance: number | null = null;
  let lastRivalAt = 0;
  let rivalRpm = 0.6;
  let muted = false;
  let compressor: DynamicsCompressorNode | null = null;
  let samples: SfxLibrary = {};
  // The recorded onboard loop, pitched by RPM, once it has loaded.
  let onboard: AudioBufferSourceNode | null = null;
  let onboardGain: GainNode | null = null;
  let ambience: AudioBufferSourceNode | null = null;
  let ambienceGain: GainNode | null = null;
  let ambienceLevel = 0;

  function start() {
    if (typeof window === 'undefined' || !('AudioContext' in window)) return;
    // Called on mount and again on every gesture until the browser lets it run.
    if (context) {
      if (context.state === 'suspended') void context.resume();
      return;
    }
    context = new AudioContext();
    noise = noiseBuffer(context, 2);

    // Everything meets at a compressor so the layers never add up to clipping.
    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.12;
    master = context.createGain();
    master.gain.value = muted ? 0 : MASTER_LEVEL;
    compressor.connect(master).connect(context.destination);

    engine = createVoice(context, compressor, true);

    // Turbo whine: a thin, high sine that climbs with revs.
    whine = context.createOscillator();
    whine.type = 'sine';
    whineGain = context.createGain();
    whineGain.gain.value = 0;
    whine.connect(whineGain).connect(compressor);
    whine.start();

    // Intake hiss under throttle.
    const intake = loopingNoise(context, noise);
    const intakeFilter = context.createBiquadFilter();
    intakeFilter.type = 'bandpass';
    intakeFilter.frequency.value = 3200;
    intakeFilter.Q.value = 0.7;
    intakeGain = context.createGain();
    intakeGain.gain.value = 0;
    intake.connect(intakeFilter).connect(intakeGain).connect(compressor);

    // Wind: low-passed noise that opens up with speed.
    const wind = loopingNoise(context, noise);
    windFilter = context.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 300;
    windGain = context.createGain();
    windGain.gain.value = 0;
    wind.connect(windFilter).connect(windGain).connect(compressor);

    // Tyre scrub: band-passed noise, silent until there is slip.
    const tyre = loopingNoise(context, noise);
    const tyreFilter = context.createBiquadFilter();
    tyreFilter.type = 'bandpass';
    tyreFilter.frequency.value = 1500;
    tyreFilter.Q.value = 0.9;
    tyreGain = context.createGain();
    tyreGain.gain.value = 0;
    tyre.connect(tyreFilter).connect(tyreGain).connect(compressor);

    // Grass and gravel: a low rumble when off the tarmac.
    const surface = loopingNoise(context, noise);
    const surfaceFilter = context.createBiquadFilter();
    surfaceFilter.type = 'lowpass';
    surfaceFilter.frequency.value = 220;
    surfaceGain = context.createGain();
    surfaceGain.gain.value = 0;
    surface.connect(surfaceFilter).connect(surfaceGain).connect(compressor);

    // The nearest rival, heard from the side it is on.
    rivalPan = context.createStereoPanner();
    rivalPan.connect(compressor);
    rival = createVoice(context, rivalPan, false);
    rival.filter.frequency.value = 900;

    if (context.state === 'suspended') void context.resume();

    // Recordings arrive whenever they arrive; the synth carries the game until then.
    const owner = context;
    void loadSfx(owner).then((library) => {
      if (context !== owner || !compressor) return;
      samples = library;
      if (library.onboard) {
        onboard = owner.createBufferSource();
        onboard.buffer = library.onboard;
        onboard.loop = true;
        onboardGain = owner.createGain();
        onboardGain.gain.value = 0;
        onboard.connect(onboardGain).connect(compressor);
        onboard.start();
      }
      if (library.ambience) {
        ambience = owner.createBufferSource();
        ambience.buffer = library.ambience;
        ambience.loop = true;
        ambienceGain = owner.createGain();
        ambienceGain.gain.value = ambienceLevel * 0.35;
        ambience.connect(ambienceGain).connect(compressor);
        ambience.start();
      }
    });
  }

  /** A short sine blip: the gantry lights, pitched up for each light and down for lights out. */
  function tone(frequency: number, seconds: number, level: number) {
    if (!context || !master) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + seconds);
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + seconds);
  }

  function setVoice(voice: EngineVoice, firingHz: number, cutoff: number, level: number, now: number, glide = 0.03) {
    voice.oscillators.forEach((oscillator, index) => {
      oscillator.frequency.setTargetAtTime(firingHz * voice.ratios[index], now, glide);
    });
    voice.filter.frequency.setTargetAtTime(cutoff, now, 0.04);
    voice.gain.gain.setTargetAtTime(level, now, 0.05);
  }

  /** Exhaust crack on an upshift: a short band-passed burst. */
  function crack(now: number) {
    if (!context || !master || !noise) return;
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 700;
    filter.Q.value = 2.5;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    source.connect(filter).connect(gain).connect(master);
    source.start(now);
    source.stop(now + 0.06);
  }

  return {
    start,

    update({ rpm, gear, throttle, brake, slip, speed, onTrack, rival: nearest }) {
      if (!context || !engine || !whine || !whineGain || !intakeGain || !windFilter || !windGain || !tyreGain || !surfaceGain) return;
      const now = context.currentTime;
      const v = Math.abs(speed);

      // Shifts are seamless on a modern gearbox: a brief pitch settle and a crack, no dip in power.
      if (gear !== lastGear) {
        if (gear > lastGear) crack(now);
        lastGear = gear;
        shiftUntil = now + 0.06;
      }
      const settle = now < shiftUntil ? 0.96 : 1;
      const firing = (FIRING_BASE_HZ + rpm * FIRING_RANGE_HZ) * settle;

      // Off throttle the note closes down and drops; on throttle it opens and rasps.
      const load = throttle > 0 ? throttle : brake > 0 ? 0 : 0.08;
      const cutoff = 500 + load * 2600 + rpm * 2600;
      const level = 0.09 + load * 0.2 + rpm * 0.1;
      // With the recorded onboard present the synth steps back to a bed under it.
      setVoice(engine, firing, cutoff, onboard ? level * 0.45 : level, now);
      if (onboard && onboardGain) {
        onboard.playbackRate.setTargetAtTime(0.72 + rpm * 0.62, now, 0.04);
        onboardGain.gain.setTargetAtTime(0.16 + load * 0.3 + rpm * 0.12, now, 0.05);
      }

      whine.frequency.setTargetAtTime(1800 + rpm * 4200, now, 0.05);
      whineGain.gain.setTargetAtTime(0.006 + throttle * 0.018 * rpm, now, 0.08);
      intakeGain.gain.setTargetAtTime(throttle * 0.028 * (0.4 + rpm * 0.6), now, 0.08);

      const speedFraction = Math.min(1, v / 85);
      windFilter.frequency.setTargetAtTime(250 + speedFraction * 900, now, 0.1);
      windGain.gain.setTargetAtTime(speedFraction * speedFraction * 0.14, now, 0.1);

      tyreGain.gain.setTargetAtTime(Math.min(0.4, slip * 0.5 + brake * Math.min(0.12, v / 400)) * Math.min(1, v / 25), now, 0.06);
      surfaceGain.gain.setTargetAtTime(onTrack ? 0 : 0.18 * Math.min(1, v / 15), now, 0.08);

      // Rival engine: level by distance, pan by side, pitch by closing rate.
      if (rival && rivalPan) {
        if (nearest) {
          let doppler = 1;
          if (lastRivalDistance !== null && now > lastRivalAt) {
            const closing = (lastRivalDistance - nearest.distance) / (now - lastRivalAt);
            doppler = 1 + Math.max(-0.25, Math.min(0.25, closing / 340));
          }
          lastRivalDistance = nearest.distance;
          lastRivalAt = now;
          // Rivals hold a steady, fairly high note; theirs is not a keyboard car.
          rivalRpm += (0.72 - rivalRpm) * 0.02;
          const rivalLevel = 0.22 / (1 + (nearest.distance / 10) ** 2);
          setVoice(rival, (FIRING_BASE_HZ + rivalRpm * FIRING_RANGE_HZ) * doppler, 1400, rivalLevel, now, 0.06);
          rivalPan.pan.setTargetAtTime(nearest.pan * 0.8, now, 0.08);
        } else {
          lastRivalDistance = null;
          rival.gain.gain.setTargetAtTime(0, now, 0.1);
        }
      }
    },

    thud(intensity) {
      if (!context || !master || !noise) return;
      const now = context.currentTime;
      const length = 0.2;
      const source = context.createBufferSource();
      source.buffer = noise;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 380;
      const gain = context.createGain();
      gain.gain.setValueAtTime(Math.min(0.9, 0.3 + intensity * 0.6), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + length);
      source.connect(filter).connect(gain).connect(master);
      source.start(now);
      source.stop(now + length);
    },

    light(index) {
      tone(440 + index * 60, 0.16, 0.12);
    },

    lightsOut() {
      tone(660, 0.5, 0.16);
    },

    passBy(pan) {
      if (!context || !compressor) return;
      const buffer = samples.passby;
      if (!buffer) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      const panner = context.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      const gain = context.createGain();
      gain.gain.value = 0.5;
      source.connect(panner).connect(gain).connect(compressor);
      source.start();
    },

    setAmbience(level) {
      ambienceLevel = level;
      if (ambienceGain && context) ambienceGain.gain.setTargetAtTime(level * 0.35, context.currentTime, 0.4);
    },

    setMuted(value) {
      muted = value;
      if (master && context) master.gain.setTargetAtTime(value ? 0 : MASTER_LEVEL, context.currentTime, 0.05);
    },

    dispose() {
      try {
        engine?.oscillators.forEach((oscillator) => oscillator.stop());
        rival?.oscillators.forEach((oscillator) => oscillator.stop());
        whine?.stop();
        onboard?.stop();
        ambience?.stop();
      } catch { /* already stopped */ }
      void context?.close();
      context = null;
      engine = null;
      rival = null;
    },
  };
}
