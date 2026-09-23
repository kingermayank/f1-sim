/**
 * Menu sounds, synthesised on the spot so there is nothing to license.
 *
 * Every sound is short and quiet: a click for a choice, a whoosh with a tick
 * for flipping between cars (panned the way you flipped), a rising two-tone
 * for opening a sheet, and a low thump for committing to a race. The kit
 * respects one switch, persisted in localStorage and exposed in the top bar.
 */
const STORAGE_KEY = 'apex.ui-sound';
export const UI_SOUND_EVENT = 'apex-ui-sound-change';
let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let enabled: boolean | null = null;

export function isUiSoundEnabled(): boolean {
  if (enabled === null) {
    try { enabled = window.localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { enabled = true; }
  }
  return enabled;
}

export function setUiSoundEnabled(value: boolean): void {
  enabled = value;
  try { window.localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off'); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(UI_SOUND_EVENT, { detail: value }));
  if (value) click(0.5);
}

function ready(): AudioContext | null {
  if (!isUiSoundEnabled() || typeof window === 'undefined' || !('AudioContext' in window)) return null;
  if (!context) {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.35;
    master.connect(context.destination);
    noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

function envelope(ctx: AudioContext, node: AudioNode, peak: number, attack: number, release: number, pan = 0): void {
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + release);
  if (pan !== 0) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    node.connect(gain).connect(panner).connect(master!);
  } else {
    node.connect(gain).connect(master!);
  }
}

/** A short tick. `pitch` in [0, 1] raises it, so a row of options climbs as you move along it. */
export function click(pitch = 0.5): void {
  const ctx = ready();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  oscillator.type = 'triangle';
  const base = 900 + pitch * 900;
  oscillator.frequency.setValueAtTime(base * 1.4, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(base, ctx.currentTime + 0.03);
  envelope(ctx, oscillator, 0.5, 0.004, 0.05);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.08);
  transient(ctx, 2600, 0.012, 0.25);
}

/** A whoosh that resolves into a tick, panned to the side you flipped towards. */
export function flip(direction: number): void {
  const ctx = ready();
  if (!ctx || !noise) return;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.6;
  filter.frequency.setValueAtTime(400, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(2800, ctx.currentTime + 0.14);
  source.connect(filter);
  envelope(ctx, filter, 0.35, 0.02, 0.16, Math.sign(direction) * 0.5);
  source.start();
  source.stop(ctx.currentTime + 0.2);
  window.setTimeout(() => click(0.65), 110);
}

/** Two rising tones: something opened. */
export function open(): void {
  const ctx = ready();
  if (!ctx) return;
  for (const [offset, frequency] of [[0, 620], [0.07, 930]] as const) {
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    const gain = ctx.createGain();
    const at = ctx.currentTime + offset;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.4, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    oscillator.connect(gain).connect(master!);
    oscillator.start(at);
    oscillator.stop(at + 0.1);
  }
}

/** A low thump with a rising sweep on top: committing to the race. */
export function confirm(): void {
  const ctx = ready();
  if (!ctx) return;
  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(160, ctx.currentTime);
  thump.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + 0.18);
  envelope(ctx, thump, 0.9, 0.006, 0.22);
  thump.start();
  thump.stop(ctx.currentTime + 0.25);
  const sweep = ctx.createOscillator();
  sweep.type = 'sawtooth';
  sweep.frequency.setValueAtTime(300, ctx.currentTime);
  sweep.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.28);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1800;
  sweep.connect(filter);
  envelope(ctx, filter, 0.16, 0.02, 0.3);
  sweep.start();
  sweep.stop(ctx.currentTime + 0.34);
}

function transient(ctx: AudioContext, frequency: number, seconds: number, level: number): void {
  if (!noise) return;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = frequency;
  source.connect(filter);
  envelope(ctx, filter, level, 0.001, seconds);
  source.start();
  source.stop(ctx.currentTime + seconds + 0.01);
}

export const uiSound = { click, flip, open, confirm };
