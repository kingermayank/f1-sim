import { describe, expect, it, vi } from 'vitest';
import { createRaceAudioController } from '../../src/audio/race-audio';
import type { RaceEvent, RaceState } from '../../src/simulation/events';

class FakeAudioParam {
  value = 0;
  cancelScheduledValues = vi.fn();
  setValueAtTime = vi.fn((value: number) => { this.value = value; });
  linearRampToValueAtTime = vi.fn((value: number) => { this.value = value; });
  exponentialRampToValueAtTime = vi.fn((value: number) => { this.value = value; });
  setTargetAtTime = vi.fn((value: number) => { this.value = value; });
}

class FakeAudioNode {
  connect = vi.fn(() => this);
  disconnect = vi.fn();
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam();
}

class FakeOscillatorNode extends FakeAudioNode {
  frequency = new FakeAudioParam();
  detune = new FakeAudioParam();
  type: OscillatorType = 'sine';
  start = vi.fn();
  stop = vi.fn();
  onended: (() => void) | null = null;
}

class FakeBiquadFilterNode extends FakeAudioNode {
  frequency = new FakeAudioParam();
  Q = new FakeAudioParam();
  type: BiquadFilterType = 'lowpass';
}

class FakeBufferSourceNode extends FakeAudioNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  playbackRate = new FakeAudioParam();
  start = vi.fn();
  stop = vi.fn();
  onended: (() => void) | null = null;
}

class FakeAudioContext {
  currentTime = 2;
  state: AudioContextState = 'suspended';
  destination = new FakeAudioNode();
  gains: FakeGainNode[] = [];
  oscillators: FakeOscillatorNode[] = [];
  filters: FakeBiquadFilterNode[] = [];
  sources: FakeBufferSourceNode[] = [];
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  createGain = vi.fn(() => {
    const node = new FakeGainNode();
    this.gains.push(node);
    return node;
  });
  createOscillator = vi.fn(() => {
    const node = new FakeOscillatorNode();
    this.oscillators.push(node);
    return node;
  });
  createBiquadFilter = vi.fn(() => {
    const node = new FakeBiquadFilterNode();
    this.filters.push(node);
    return node;
  });
  createBufferSource = vi.fn(() => {
    const node = new FakeBufferSourceNode();
    this.sources.push(node);
    return node;
  });
  createBuffer = vi.fn((_channels: number, length: number) => ({
    getChannelData: () => new Float32Array(length),
  }));
}

function snapshot(speed: number): RaceState {
  return {
    seed: 'audio-test', tick: 20, elapsedSeconds: 2, phase: 'racing', flag: 'green', weather: 'sunny', safetyCar: 'none',
    cars: [{
      driverId: 'norris', lap: 1, distance: 0.2, lateralOffset: 0, speed,
      tire: { compound: 'medium', wear: 0.1, temperature: 0.8 }, fuelFactor: 0.98,
      damage: 0, pitState: 'track', pitProgress: 0, position: 1,
      timing: { lastLap: null, bestLap: null, totalTime: 2 }, targetLine: 'racing', status: 'running',
    }],
    events: [],
  };
}

function setupController() {
  const context = new FakeAudioContext();
  const factory = vi.fn(() => context as unknown as AudioContext);
  const controller = createRaceAudioController({ createContext: factory });
  return { context, controller, factory };
}

describe('RaceAudioController', () => {
  it('creates one audio context only after explicit resume', async () => {
    const { context, controller, factory } = setupController();

    controller.setMuted(false);
    controller.update(snapshot(0.02), 'norris');
    expect(factory).not.toHaveBeenCalled();

    await expect(controller.resume()).resolves.toBe(true);
    await controller.resume();
    expect(factory).toHaveBeenCalledOnce();
    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.oscillators.slice(0, 2).every((node) => node.start.mock.calls.length === 1)).toBe(true);
  });

  it('smoothly changes selected-car engine pitch and gain with speed', async () => {
    const { context, controller } = setupController();
    controller.setMuted(false);
    await controller.resume();

    controller.update(snapshot(0.004), 'norris');
    const lowPitch = context.oscillators[0].frequency.value;
    const lowGain = context.gains[1].gain.value;
    controller.update(snapshot(0.03), 'norris');

    expect(context.oscillators[0].frequency.value).toBeGreaterThan(lowPitch);
    expect(context.gains[1].gain.value).toBeGreaterThan(lowGain);
    expect(context.gains[0].gain.value).toBeLessThanOrEqual(0.16);
    expect(context.oscillators[0].frequency.setTargetAtTime).toHaveBeenCalled();
  });

  it('suppresses pit and incident envelopes while muted', async () => {
    const { context, controller } = setupController();
    await controller.resume();
    const persistentOscillators = context.oscillators.length;
    const persistentSources = context.sources.length;
    const events: RaceEvent[] = [
      { type: 'pit-entry', tick: 10, driverId: 'norris' },
      { type: 'incident', tick: 11, driverIds: ['norris'], severity: 'major' },
    ];

    controller.setMuted(true);
    controller.handleEvents(events);
    expect(context.oscillators).toHaveLength(persistentOscillators);
    expect(context.sources).toHaveLength(persistentSources);

    controller.setMuted(false);
    controller.handleEvents(events);
    expect(context.oscillators.length).toBeGreaterThan(persistentOscillators);
    expect(context.sources.length).toBeGreaterThan(persistentSources);
  });

  it('stops and disconnects every owned node on dispose', async () => {
    const { context, controller } = setupController();
    controller.setMuted(false);
    await controller.resume();
    controller.handleEvents([{ type: 'incident', tick: 11, driverIds: ['norris'], severity: 'major' }]);

    await controller.dispose();

    expect([...context.oscillators, ...context.sources].every((node) => node.stop.mock.calls.length >= 1)).toBe(true);
    expect([...context.oscillators, ...context.sources, ...context.gains, ...context.filters]
      .every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('releases every one-shot envelope node after repeated events end', async () => {
    const { context, controller } = setupController();
    controller.setMuted(false);
    await controller.resume();
    const liveNodeCount = () => [
      ...context.oscillators,
      ...context.sources,
      ...context.gains,
      ...context.filters,
    ].filter((node) => node.disconnect.mock.calls.length === 0).length;
    const baseline = liveNodeCount();

    for (let index = 0; index < 12; index += 1) {
      if (index % 2 === 0) {
        controller.handleEvents([{ type: 'pit-entry', tick: index, driverId: 'norris' }]);
        context.oscillators.at(-1)?.onended?.();
      } else {
        controller.handleEvents([{ type: 'incident', tick: index, driverIds: ['norris'], severity: 'minor' }]);
        context.sources.at(-1)?.onended?.();
      }
      expect(liveNodeCount()).toBe(baseline);
    }

    await expect(controller.dispose()).resolves.toBeUndefined();
    expect(() => context.oscillators.at(-1)?.onended?.()).not.toThrow();
    expect(() => context.sources.at(-1)?.onended?.()).not.toThrow();
  });

  it('fails closed when Web Audio is unavailable', async () => {
    const controller = createRaceAudioController({ createContext: () => { throw new Error('unsupported'); } });
    await expect(controller.resume()).resolves.toBe(false);
    expect(() => controller.update(snapshot(0.02), 'norris')).not.toThrow();
    expect(() => controller.handleEvents([{ type: 'pit-exit', tick: 2, driverId: 'norris' }])).not.toThrow();
    await expect(controller.dispose()).resolves.toBeUndefined();
  });
});
