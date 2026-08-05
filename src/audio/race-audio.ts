import type { RaceEvent, RaceState } from '../simulation/events';

const MASTER_GAIN = 0.16;
const ENGINE_GAIN_MAX = 0.075;
const CROWD_GAIN = 0.018;
const TIRE_GAIN_MAX = 0.025;
const RAMP_SECONDS = 0.08;

export interface RaceAudioDependencies {
  createContext(): AudioContext;
}

export interface RaceAudioController {
  resume(): Promise<boolean>;
  update(snapshot: Readonly<RaceState>, selectedDriverId: string | null): void;
  handleEvents(events: readonly RaceEvent[]): void;
  setMuted(muted: boolean): void;
  dispose(): Promise<void>;
}

function defaultContextFactory(): AudioContext {
  const AudioContextConstructor = globalThis.AudioContext
    ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error('Web Audio is unavailable');
  return new AudioContextConstructor();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function setSmooth(param: AudioParam, value: number, now: number, duration = RAMP_SECONDS): void {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, duration);
}

function fillNoise(buffer: AudioBuffer): void {
  const samples = buffer.getChannelData(0);
  let state = 0x5f3759df;
  for (let index = 0; index < samples.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    samples[index] = (state / 0x80000000) - 1;
  }
}

export function createRaceAudioController(
  dependencies: RaceAudioDependencies = { createContext: defaultContextFactory },
): RaceAudioController {
  let context: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let engineGain: GainNode | null = null;
  let primaryEngine: OscillatorNode | null = null;
  let harmonicEngine: OscillatorNode | null = null;
  let tireGain: GainNode | null = null;
  let muted = true;
  let disposed = false;
  const ownedNodes = new Set<AudioNode>();
  const ownedSources = new Set<AudioScheduledSourceNode>();
  const transientCleanups = new Map<AudioScheduledSourceNode, () => void>();

  const own = <Node extends AudioNode>(node: Node): Node => {
    ownedNodes.add(node);
    return node;
  };

  const ownSource = <Node extends AudioScheduledSourceNode>(node: Node): Node => {
    ownedNodes.add(node);
    ownedSources.add(node);
    return node;
  };

  const createNoiseSource = (audioContext: AudioContext, seconds: number): AudioBufferSourceNode => {
    const sampleRate = Number.isFinite(audioContext.sampleRate) ? audioContext.sampleRate : 8_000;
    const buffer = audioContext.createBuffer(1, Math.max(1, Math.round(sampleRate * seconds)), sampleRate);
    fillNoise(buffer);
    const source = ownSource(audioContext.createBufferSource());
    source.buffer = buffer;
    return source;
  };

  const releaseOnEnded = (source: AudioScheduledSourceNode, nodes: readonly AudioNode[]): void => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      source.onended = null;
      transientCleanups.delete(source);
      ownedSources.delete(source);
      for (const node of nodes) {
        try { node.disconnect(); } catch { /* A disconnected node is already safe. */ }
        ownedNodes.delete(node);
      }
    };
    transientCleanups.set(source, release);
    source.onended = release;
  };

  const initializeGraph = (audioContext: AudioContext): void => {
    const now = audioContext.currentTime;
    masterGain = own(audioContext.createGain());
    masterGain.gain.setValueAtTime(muted ? 0 : MASTER_GAIN, now);
    masterGain.connect(audioContext.destination);

    engineGain = own(audioContext.createGain());
    engineGain.gain.setValueAtTime(0.018, now);
    engineGain.connect(masterGain);

    primaryEngine = ownSource(audioContext.createOscillator());
    primaryEngine.type = 'sawtooth';
    primaryEngine.frequency.setValueAtTime(85, now);
    primaryEngine.connect(engineGain);

    harmonicEngine = ownSource(audioContext.createOscillator());
    harmonicEngine.type = 'triangle';
    harmonicEngine.frequency.setValueAtTime(170, now);
    harmonicEngine.detune.setValueAtTime(-7, now);
    harmonicEngine.connect(engineGain);
    primaryEngine.start(now);
    harmonicEngine.start(now);

    const crowdGain = own(audioContext.createGain());
    crowdGain.gain.setValueAtTime(CROWD_GAIN, now);
    crowdGain.connect(masterGain);
    const crowdFilter = own(audioContext.createBiquadFilter());
    crowdFilter.type = 'lowpass';
    crowdFilter.frequency.setValueAtTime(720, now);
    crowdFilter.Q.setValueAtTime(0.35, now);
    crowdFilter.connect(crowdGain);
    const crowdNoise = createNoiseSource(audioContext, 1.5);
    crowdNoise.loop = true;
    crowdNoise.connect(crowdFilter);
    crowdNoise.start(now);

    tireGain = own(audioContext.createGain());
    tireGain.gain.setValueAtTime(0, now);
    tireGain.connect(masterGain);
    const tireFilter = own(audioContext.createBiquadFilter());
    tireFilter.type = 'bandpass';
    tireFilter.frequency.setValueAtTime(2_200, now);
    tireFilter.Q.setValueAtTime(0.8, now);
    tireFilter.connect(tireGain);
    const tireNoise = createNoiseSource(audioContext, 0.85);
    tireNoise.loop = true;
    tireNoise.connect(tireFilter);
    tireNoise.start(now);
  };

  const createPitEnvelope = (audioContext: AudioContext): void => {
    if (!masterGain) return;
    const now = audioContext.currentTime;
    const gain = own(audioContext.createGain());
    const oscillator = ownSource(audioContext.createOscillator());
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(460, now);
    oscillator.frequency.exponentialRampToValueAtTime(690, now + 0.12);
    oscillator.connect(gain);
    gain.connect(masterGain);
    releaseOnEnded(oscillator, [oscillator, gain]);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  };

  const createImpactEnvelope = (audioContext: AudioContext, major: boolean): void => {
    if (!masterGain) return;
    const now = audioContext.currentTime;
    const gain = own(audioContext.createGain());
    const filter = own(audioContext.createBiquadFilter());
    const noise = createNoiseSource(audioContext, 0.28);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(major ? 0.065 : 0.04, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (major ? 0.25 : 0.14));
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(major ? 1_150 : 1_650, now);
    filter.Q.setValueAtTime(0.5, now);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    releaseOnEnded(noise, [noise, filter, gain]);
    noise.start(now);
    noise.stop(now + 0.3);
  };

  return {
    async resume(): Promise<boolean> {
      if (disposed) disposed = false;
      try {
        if (!context) {
          const nextContext = dependencies.createContext();
          initializeGraph(nextContext);
          context = nextContext;
        }
        if (context.state === 'suspended') await context.resume();
        return context.state !== 'closed';
      } catch {
        if (context) {
          try { await context.close(); } catch { /* Web Audio shutdown is best effort. */ }
        }
        context = null;
        masterGain = null;
        engineGain = null;
        primaryEngine = null;
        harmonicEngine = null;
        tireGain = null;
        ownedNodes.clear();
        ownedSources.clear();
        transientCleanups.clear();
        return false;
      }
    },

    update(snapshot, selectedDriverId): void {
      if (!context || !engineGain || !primaryEngine || !harmonicEngine || !tireGain) return;
      const selectedCar = snapshot.cars.find((car) => car.driverId === selectedDriverId)
        ?? snapshot.cars.find((car) => car.position === 1)
        ?? snapshot.cars[0];
      if (!selectedCar) return;
      const now = context.currentTime;
      const normalizedSpeed = clamp(selectedCar.speed / 0.032, 0, 1);
      const pitch = 78 + normalizedSpeed * 238;
      const activeGain = selectedCar.status === 'running' ? 0.018 + normalizedSpeed * 0.052 : 0;
      const scrub = selectedCar.status === 'running'
        ? clamp((Math.abs(selectedCar.lateralOffset) * 0.5 + selectedCar.damage * 0.8 + (selectedCar.targetLine === 'racing' ? 0 : 0.08)) * normalizedSpeed, 0, 1)
        : 0;
      setSmooth(primaryEngine.frequency, pitch, now);
      setSmooth(harmonicEngine.frequency, pitch * 1.98, now);
      setSmooth(engineGain.gain, Math.min(ENGINE_GAIN_MAX, activeGain), now);
      setSmooth(tireGain.gain, Math.min(TIRE_GAIN_MAX, scrub * TIRE_GAIN_MAX), now);
    },

    handleEvents(events): void {
      if (!context || muted) return;
      for (const event of events) {
        if (event.type === 'incident') createImpactEnvelope(context, event.severity === 'major');
        else if (event.type === 'pit-entry' || event.type === 'pit-exit' || event.type === 'tire-change') createPitEnvelope(context);
      }
    },

    setMuted(nextMuted): void {
      muted = nextMuted;
      if (context && masterGain) setSmooth(masterGain.gain, muted ? 0 : MASTER_GAIN, context.currentTime, 0.035);
    },

    async dispose(): Promise<void> {
      for (const source of ownedSources) {
        try { source.stop(); } catch { /* A stopped source is already safe. */ }
      }
      for (const release of [...transientCleanups.values()]) release();
      for (const node of ownedNodes) {
        try { node.disconnect(); } catch { /* A disconnected node is already safe. */ }
      }
      ownedSources.clear();
      ownedNodes.clear();
      transientCleanups.clear();
      const currentContext = context;
      context = null;
      masterGain = null;
      engineGain = null;
      primaryEngine = null;
      harmonicEngine = null;
      tireGain = null;
      disposed = true;
      if (currentContext && currentContext.state !== 'closed') {
        try { await currentContext.close(); } catch { /* Web Audio shutdown is best effort. */ }
      }
    },
  };
}

export const raceAudioController = createRaceAudioController();
