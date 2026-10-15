import { describe, expect, it } from 'vitest';
import { EngineDsp, firingHz, rpmFromNormalised, type EngineDspInput } from '../../src/game/audio/engine-dsp';
import { EngineVoices } from '../../src/game/audio/engine-voices';

const FS = 48_000;

function render(dsp: EngineDsp, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(FS * seconds));
  // In worklet-sized blocks, as the browser calls it.
  for (let offset = 0; offset < out.length; offset += 128) dsp.process(out, offset, Math.min(128, out.length - offset));
  return out;
}

function steady(input: EngineDspInput, seconds = 1): { out: Float32Array; rpm: number } {
  const dsp = new EngineDsp(FS, { seed: 3 });
  dsp.setInput(input);
  render(dsp, 0.4); // let the revs, load and pipes settle
  const out = render(dsp, seconds);
  return { out, rpm: dsp.rpm };
}

function rms(signal: Float32Array, from = 0, to = signal.length): number {
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += signal[index] * signal[index];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/**
 * The strongest component (Hz) between 0.6x and 1.6x the expected firing frequency, from a
 * Hann-windowed Goertzel scan: a half-firing or crank-order line, or a pipe resonance, would
 * show up here instead if it outweighed the firing.
 */
function dominantFrequency(signal: Float32Array, expectedHz: number): number {
  const windowed = new Float64Array(signal.length);
  for (let index = 0; index < signal.length; index += 1) {
    windowed[index] = signal[index] * (0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (signal.length - 1)));
  }
  let best = -1;
  let bestHz = 0;
  for (let hz = expectedHz * 0.6; hz <= expectedHz * 1.6; hz += expectedHz * 0.0025) {
    const coefficient = 2 * Math.cos((2 * Math.PI * hz) / FS);
    let s1 = 0;
    let s2 = 0;
    for (let index = 0; index < windowed.length; index += 1) {
      const s0 = windowed[index] + coefficient * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const power = s1 * s1 + s2 * s2 - coefficient * s1 * s2;
    if (power > best) {
      best = power;
      bestHz = hz;
    }
  }
  return bestHz;
}

describe('engine model', () => {
  it('maps the game rpm onto a 2026 power unit: idle, the post-shift drop and the shift point', () => {
    expect(rpmFromNormalised(0.12)).toBe(4000);
    expect(rpmFromNormalised(0)).toBe(4000);
    expect(rpmFromNormalised(0.35)).toBeCloseTo(9500, 0);
    expect(rpmFromNormalised(0.98)).toBeCloseTo(12200, 0);
    expect(firingHz(12000)).toBe(600);
  });

  const cases: { name: string; input: EngineDspInput }[] = [
    { name: 'idling on the grid', input: { rpm: 0.12, gear: 1, throttle: 0, brake: 0, speed: 0 } },
    { name: 'mid revs, flat out', input: { rpm: 0.5, gear: 3, throttle: 1, brake: 0, speed: 30 } },
    { name: 'near the shift point, flat out', input: { rpm: 0.9, gear: 6, throttle: 1, brake: 0, speed: 70 } },
    { name: 'high revs on the overrun', input: { rpm: 0.8, gear: 7, throttle: 0, brake: 0.6, speed: 70 } },
  ];

  for (const { name, input } of cases) {
    it(`fires six cylinders every two revolutions (rpm / 20 Hz dominates): ${name}`, () => {
      const { out, rpm } = steady(input);
      expect(rpm).toBeCloseTo(rpmFromNormalised(input.rpm), -2);
      expect(out.every(Number.isFinite)).toBe(true);
      const peak = out.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
      expect(peak).toBeLessThan(0.8);
      expect(rms(out)).toBeGreaterThan(0.005);
      const expected = firingHz(rpm);
      const detected = dominantFrequency(out, expected);
      expect(Math.abs(detected / expected - 1), `${detected.toFixed(1)} Hz detected, ${expected.toFixed(1)} Hz expected`).toBeLessThan(0.03);
    });
  }

  it('is louder flat out than idling or on the overrun', () => {
    const idle = rms(steady(cases[0].input).out);
    const flat = rms(steady(cases[2].input).out);
    const overrun = rms(steady(cases[3].input).out);
    expect(flat).toBeGreaterThan(idle * 2);
    expect(flat).toBeGreaterThan(overrun * 2);
  });

  it('cuts the ignition on an upshift and drops to the next gear', () => {
    const dsp = new EngineDsp(FS, { seed: 5 });
    dsp.setInput({ rpm: 0.98, gear: 3, throttle: 1, brake: 0, speed: 37 });
    render(dsp, 0.5);
    const before = rms(render(dsp, 0.03));
    dsp.setInput({ rpm: 0.35, gear: 4, throttle: 1, brake: 0, speed: 38 });
    const shift = render(dsp, 0.2);
    // The crack lands in the first few ms; the cut silences the firing after it.
    expect(rms(shift, Math.round(FS * 0.012), Math.round(FS * 0.035))).toBeLessThan(before * 0.8);
    expect(dsp.rpm).toBeCloseTo(rpmFromNormalised(0.35), -2);
  });

  it('keeps going, finite, through a whole lap of abuse', () => {
    const dsp = new EngineDsp(44_100, { seed: 9 });
    const out = new Float32Array(441);
    let speed = 0;
    let bad = 0;
    for (let frame = 0; frame < 1200; frame += 1) {
      const throttle = frame % 240 < 160 ? 1 : 0;
      speed = Math.max(0, Math.min(92, speed + (throttle ? 0.4 : -0.9)));
      const gear = Math.min(8, 1 + Math.floor(speed / 12));
      dsp.setInput({ rpm: speed < 0.5 ? (throttle ? 0.95 : 0.12) : 0.35 + ((speed % 12) / 12) * 0.63, gear, throttle, brake: 1 - throttle, speed });
      dsp.process(out);
      for (const value of out) if (!(Number.isFinite(value) && Math.abs(value) <= 1)) bad += 1;
    }
    expect(bad).toBe(0);
  });

  it('rests the rival engine when no rival is close', () => {
    const voices = new EngineVoices(FS);
    const player = new Float32Array(128);
    const rival = new Float32Array(128).fill(1);
    voices.handle({ type: 'player', input: { rpm: 0.6, gear: 4, throttle: 1, brake: 0, speed: 40 } });
    voices.render(player, rival);
    expect(rival.every((value) => value === 0)).toBe(true);
    voices.handle({ type: 'rival', input: { rpm: 0.72, gear: 6, throttle: 0.85, brake: 0, speed: 70, pitch: 1.05 } });
    for (let block = 0; block < 40; block += 1) voices.render(player, rival);
    expect(rms(rival)).toBeGreaterThan(0.001);
  });
});
