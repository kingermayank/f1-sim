/**
 * Procedural engine and tyre audio for the player's car.
 *
 * Two oscillators pitched by RPM give the engine its note, with a brief dip on
 * gear changes; band-passed noise rises with lateral slip for tyre scrub. All
 * synthesised, so there is nothing new to license.
 */
export interface EngineAudio {
  start(): void;
  update(rpm: number, gear: number, throttle: number, slip: number, speed: number): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

export function createEngineAudio(): EngineAudio {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let low: OscillatorNode | null = null;
  let high: OscillatorNode | null = null;
  let engineGain: GainNode | null = null;
  let tyreGain: GainNode | null = null;
  let lastGear = 1;
  let shiftDipUntil = 0;
  let muted = false;

  function start() {
    if (context || typeof window === 'undefined' || !('AudioContext' in window)) return;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(context.destination);

    engineGain = context.createGain();
    engineGain.gain.value = 0.25;
    engineGain.connect(master);

    low = context.createOscillator();
    low.type = 'sawtooth';
    const lowFilter = context.createBiquadFilter();
    lowFilter.type = 'lowpass';
    lowFilter.frequency.value = 900;
    low.connect(lowFilter).connect(engineGain);
    low.start();

    high = context.createOscillator();
    high.type = 'square';
    const highGain = context.createGain();
    highGain.gain.value = 0.35;
    const highFilter = context.createBiquadFilter();
    highFilter.type = 'bandpass';
    highFilter.frequency.value = 2400;
    highFilter.Q.value = 1.2;
    high.connect(highFilter).connect(highGain).connect(engineGain);
    high.start();

    // Tyre scrub: looping noise through a band-pass, silent until there is slip.
    const seconds = 2;
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1800;
    noiseFilter.Q.value = 0.8;
    tyreGain = context.createGain();
    tyreGain.gain.value = 0;
    noise.connect(noiseFilter).connect(tyreGain).connect(master);
    noise.start();

    if (context.state === 'suspended') void context.resume();
  }

  return {
    start,
    update(rpm, gear, throttle, slip, speed) {
      if (!context || !low || !high || !engineGain || !tyreGain) return;
      const now = context.currentTime;
      if (gear !== lastGear) {
        lastGear = gear;
        shiftDipUntil = now + 0.09;
      }
      const dip = now < shiftDipUntil ? 0.55 : 1;
      const base = (55 + rpm * 165) * dip;
      low.frequency.setTargetAtTime(base, now, 0.03);
      high.frequency.setTargetAtTime(base * 3, now, 0.03);
      engineGain.gain.setTargetAtTime(0.12 + throttle * 0.16 + rpm * 0.08, now, 0.05);
      tyreGain.gain.setTargetAtTime(Math.min(0.5, slip * 0.7) * Math.min(1, speed / 30), now, 0.06);
    },
    setMuted(value) {
      muted = value;
      if (master && context) master.gain.setTargetAtTime(value ? 0 : 0.5, context.currentTime, 0.05);
    },
    dispose() {
      try { low?.stop(); high?.stop(); } catch { /* already stopped */ }
      void context?.close();
      context = null;
    },
  };
}
