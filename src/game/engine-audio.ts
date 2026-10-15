/**
 * Race audio for the player's car.
 *
 * The engine is a physical model of the 2026 power unit (see
 * `audio/engine-dsp.ts`): crank-driven cylinder firings through exhaust and
 * intake waveguides, with shift cuts, blips, overrun crackle, turbo and
 * MGU-K. It runs in an AudioWorklet, or on the main thread where worklets are
 * unavailable. The nearest rival is a second copy of the same model heard
 * from outside, panned to its side and Doppler-shifted. Wind, tyre scrub and
 * the off-track rumble are filtered noise.
 *
 * Recorded pass-bys, the crowd and the flyover bed layer on top when their
 * files are present (see `sfx.ts`), but the cars never depend on them: the
 * recordings are not shipped with the game, so the model has to stand alone.
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
  /** The flyover bed (cars on the straight), 0-1, for the intro only. */
  setIntro(level: number): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

import engineWorkletUrl from './audio/engine-worklet.ts?worker&url';
import { ENGINE_PROCESSOR, EngineVoices, type EngineMessage } from './audio/engine-voices';
import { loadSfx, type SfxLibrary, type SfxName } from './sfx';

const MASTER_LEVEL = 0.6;
/** The model peaks near ±0.7; this sits it just into the compressor at full song. */
const ENGINE_LEVEL = 1.4;
/** Rival engine level at close quarters. */
const RIVAL_LEVEL = 0.9;
/** The recorded onboard loop is not loaded: the model is the engine. */
const RECORDINGS: SfxName[] = ['passby', 'passbyB', 'passbyC', 'passbyD', 'passbyE', 'ambience', 'straight'];

/** The engines' audio node, worklet or fallback, and how to talk to it. */
interface EngineHost {
  node: AudioNode;
  post(message: EngineMessage): void;
  stop(): void;
}

/**
 * The engines run in an AudioWorklet. Where there is none (an insecure origin
 * or an old browser) or it fails to load, the same model runs on the main
 * thread in a ScriptProcessor: more latency, same sound.
 */
async function createEngineHost(context: AudioContext): Promise<EngineHost> {
  if ('audioWorklet' in context && context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
    try {
      await context.audioWorklet.addModule(engineWorkletUrl);
      const node = new AudioWorkletNode(context, ENGINE_PROCESSOR, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      return {
        node,
        post: (message) => node.port.postMessage(message),
        stop: () => {
          node.port.postMessage({ type: 'stop' } satisfies EngineMessage);
          node.disconnect();
        },
      };
    } catch {
      // Fall through to the main-thread engine.
    }
  }
  const voices = new EngineVoices(context.sampleRate);
  const node = context.createScriptProcessor(1024, 1, 2);
  node.onaudioprocess = (event) => {
    voices.render(event.outputBuffer.getChannelData(0), event.outputBuffer.getChannelData(1));
  };
  return {
    node,
    post: (message) => voices.handle(message),
    stop: () => {
      node.onaudioprocess = null;
      node.disconnect();
    },
  };
}

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
  // Each layer starts somewhere else in the buffer so they never move in step.
  source.start(0, Math.random() * buffer.duration);
  return source;
}

export function createEngineAudio(): EngineAudio {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let compressor: DynamicsCompressorNode | null = null;
  let host: EngineHost | null = null;
  let splitter: ChannelSplitterNode | null = null;
  let engineGain: GainNode | null = null;
  let rivalFilter: BiquadFilterNode | null = null;
  let rivalGain: GainNode | null = null;
  let rivalPan: StereoPannerNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  let windGain: GainNode | null = null;
  let hissGain: GainNode | null = null;
  let tyreFilter: BiquadFilterNode | null = null;
  let tyreGain: GainNode | null = null;
  let surfaceGain: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let noiseSources: AudioBufferSourceNode[] = [];
  let lastRivalDistance: number | null = null;
  let lastRivalAt = 0;
  let closing = 0;
  let rivalRpm = 0.72;
  let rivalHeard = false;
  let muted = false;
  let samples: SfxLibrary = {};
  let ambience: AudioBufferSourceNode | null = null;
  let ambienceGain: GainNode | null = null;
  let ambienceLevel = 0;
  let flyover: AudioBufferSourceNode | null = null;
  let flyoverGain: GainNode | null = null;
  let flyoverLevel = 0;

  function start() {
    if (typeof window === 'undefined' || !('AudioContext' in window)) return;
    // Called on mount and again on every gesture until the browser lets it run.
    if (context) {
      if (context.state === 'suspended') void context.resume();
      return;
    }
    context = new AudioContext({ latencyHint: 'interactive' });
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

    // The engines: channel 0 is the player's car, channel 1 the nearest rival.
    splitter = context.createChannelSplitter(2);
    engineGain = context.createGain();
    engineGain.gain.value = ENGINE_LEVEL;
    splitter.connect(engineGain, 0).connect(compressor);
    rivalFilter = context.createBiquadFilter();
    rivalFilter.type = 'lowpass';
    rivalFilter.frequency.value = 6000;
    rivalFilter.Q.value = 0.6;
    rivalGain = context.createGain();
    rivalGain.gain.value = 0;
    rivalPan = context.createStereoPanner();
    splitter.connect(rivalFilter, 1).connect(rivalGain).connect(rivalPan).connect(compressor);

    // Wind: a low buffet and a high hiss, both opening up with speed.
    const wind = loopingNoise(context, noise);
    windFilter = context.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 300;
    windGain = context.createGain();
    windGain.gain.value = 0;
    wind.connect(windFilter).connect(windGain).connect(compressor);
    const hiss = loopingNoise(context, noise);
    const hissFilter = context.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.frequency.value = 3500;
    hissFilter.Q.value = 0.5;
    hissGain = context.createGain();
    hissGain.gain.value = 0;
    hiss.connect(hissFilter).connect(hissGain).connect(compressor);

    // Tyre scrub: band-passed noise, silent until there is slip.
    const tyre = loopingNoise(context, noise);
    tyreFilter = context.createBiquadFilter();
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
    noiseSources = [wind, hiss, tyre, surface];

    if (context.state === 'suspended') void context.resume();

    const owner = context;
    createEngineHost(owner).then((created) => {
      if (context !== owner || !splitter) {
        created.stop();
        return;
      }
      host = created;
      created.node.connect(splitter);
    }).catch(() => {
      // No engine at all is better than a broken race: the rest of the audio still plays.
    });

    // Recordings arrive whenever they arrive, if they exist at all.
    void loadSfx(owner, RECORDINGS).then((library) => {
      if (context !== owner || !compressor) return;
      samples = library;
      if (library.straight) {
        flyover = owner.createBufferSource();
        flyover.buffer = library.straight;
        flyover.loop = true;
        flyoverGain = owner.createGain();
        flyoverGain.gain.value = flyoverLevel * 0.5;
        flyover.connect(flyoverGain).connect(compressor);
        flyover.start();
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

  return {
    start,

    update({ rpm, gear, throttle, brake, slip, speed, onTrack, rival: nearest }) {
      if (!context || !windFilter || !windGain || !hissGain || !tyreFilter || !tyreGain || !surfaceGain) return;
      const now = context.currentTime;
      const v = Math.abs(speed);

      host?.post({ type: 'player', input: { rpm, gear, throttle, brake, speed: v } });

      const speedFraction = Math.min(1, v / 85);
      windFilter.frequency.setTargetAtTime(250 + speedFraction * 900, now, 0.1);
      windGain.gain.setTargetAtTime(speedFraction * speedFraction * 0.16, now, 0.1);
      hissGain.gain.setTargetAtTime(speedFraction * speedFraction * speedFraction * 0.05, now, 0.1);

      const scrub = Math.min(0.4, slip * 0.5 + brake * Math.min(0.12, v / 400)) * Math.min(1, v / 25);
      tyreGain.gain.setTargetAtTime(scrub, now, 0.06);
      tyreFilter.frequency.setTargetAtTime(1100 + Math.min(1, v / 60) * 900, now, 0.1);
      surfaceGain.gain.setTargetAtTime(onTrack ? 0 : 0.18 * Math.min(1, v / 15), now, 0.08);

      // Rival engine: level and brightness by distance, pan by side, pitch by closing rate.
      if (!rivalGain || !rivalPan || !rivalFilter) return;
      if (nearest) {
        if (lastRivalDistance !== null && now > lastRivalAt) {
          const rate = (lastRivalDistance - nearest.distance) / (now - lastRivalAt);
          closing += (Math.max(-60, Math.min(60, rate)) - closing) * 0.15;
        }
        lastRivalDistance = nearest.distance;
        lastRivalAt = now;
        const doppler = 343 / Math.max(250, 343 - closing);
        // Rivals hold a fairly high note that wanders as they work the car.
        rivalRpm += (0.72 + 0.12 * Math.sin(now * 0.7) - rivalRpm) * 0.02;
        host?.post({ type: 'rival', input: { rpm: rivalRpm, gear: 6, throttle: 0.85, brake: 0, speed: 70, pitch: doppler } });
        rivalHeard = true;
        const level = RIVAL_LEVEL / (1 + (nearest.distance / 8) ** 2);
        rivalGain.gain.setTargetAtTime(level, now, 0.06);
        rivalFilter.frequency.setTargetAtTime(9000 / (1 + nearest.distance / 15), now, 0.08);
        rivalPan.pan.setTargetAtTime(nearest.pan * 0.8, now, 0.08);
      } else {
        lastRivalDistance = null;
        closing = 0;
        rivalGain.gain.setTargetAtTime(0, now, 0.1);
        if (rivalHeard) host?.post({ type: 'rival', input: null });
        rivalHeard = false;
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
      source.start(now, Math.random() * 1.5);
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
      const choices = (['passby', 'passbyB', 'passbyC', 'passbyD', 'passbyE'] as const)
        .map((name) => samples[name])
        .filter((buffer): buffer is AudioBuffer => Boolean(buffer));
      const buffer = choices[Math.floor(Math.random() * choices.length)];
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

    setIntro(level) {
      flyoverLevel = level;
      if (flyoverGain && context) flyoverGain.gain.setTargetAtTime(level * 0.5, context.currentTime, 0.6);
    },

    setMuted(value) {
      muted = value;
      if (master && context) master.gain.setTargetAtTime(value ? 0 : MASTER_LEVEL, context.currentTime, 0.05);
    },

    dispose() {
      host?.stop();
      try {
        noiseSources.forEach((source) => source.stop());
        ambience?.stop();
        flyover?.stop();
      } catch { /* already stopped */ }
      void context?.close();
      context = null;
      host = null;
      splitter = null;
      noiseSources = [];
    },
  };
}
