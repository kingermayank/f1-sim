import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RACE_CONFIG } from '../../src/domain/race-config';
import { PLAYBACK_SPEEDS, PREFERENCES_STORAGE_KEY, createRaceStore, raceStore } from '../../src/store/race-store';

describe('raceStore', () => {
  beforeEach(() => {
    raceStore.getState().restart(DEFAULT_RACE_CONFIG.seed);
  });

  it('pauses, changes speed, and replays a seed', () => {
    const initial = raceStore.getState().snapshot;

    raceStore.getState().setSpeed(4);
    raceStore.getState().tick(1);
    expect(raceStore.getState().snapshot.tick).toBeGreaterThan(initial.tick);

    raceStore.getState().togglePause();
    const pausedTick = raceStore.getState().snapshot.tick;
    raceStore.getState().tick(1);
    expect(raceStore.getState().snapshot.tick).toBe(pausedTick);

    raceStore.getState().replaySeed();
    expect(raceStore.getState().snapshot.seed).toBe(initial.seed);
    expect(raceStore.getState().snapshot.tick).toBe(0);
  });

  it('publishes immutable snapshots and a bounded drained event feed', () => {
    raceStore.getState().tick(60);

    const { eventFeed, snapshot } = raceStore.getState();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.cars)).toBe(true);
    expect(eventFeed).toHaveLength(100);
    expect(snapshot.events.length).toBeGreaterThan(eventFeed.length);
  });

  it('accepts only supported playback speeds and camera modes', () => {
    expect(PLAYBACK_SPEEDS).toEqual([0.25, 0.5, 1, 2, 4, 8]);
    raceStore.getState().setSpeed(0.25);
    expect(raceStore.getState().speed).toBe(0.25);
    raceStore.getState().setSpeed(0.5);
    expect(raceStore.getState().speed).toBe(0.5);
    raceStore.getState().setSpeed(8);
    raceStore.getState().setSpeed(3 as never);
    expect(raceStore.getState().speed).toBe(8);

    raceStore.getState().setCameraMode('cockpit');
    raceStore.getState().setCameraMode('sidecar' as never);
    expect(raceStore.getState().cameraMode).toBe('cockpit');
  });

  it('scales fractional playback deterministically while preserving pause and replay behavior', () => {
    const quarter = createRaceStore(DEFAULT_RACE_CONFIG, { storage: null });
    const half = createRaceStore(DEFAULT_RACE_CONFIG, { storage: null });
    const normal = createRaceStore(DEFAULT_RACE_CONFIG, { storage: null });

    quarter.getState().setSpeed(0.25);
    quarter.getState().tick(4);
    half.getState().setSpeed(0.5);
    half.getState().tick(2);
    normal.getState().tick(1);
    expect(quarter.getState().snapshot).toEqual(normal.getState().snapshot);
    expect(half.getState().snapshot).toEqual(normal.getState().snapshot);

    quarter.getState().togglePause();
    const pausedSnapshot = quarter.getState().snapshot;
    quarter.getState().tick(4);
    expect(quarter.getState().snapshot).toBe(pausedSnapshot);

    quarter.getState().replaySeed();
    expect(quarter.getState()).toMatchObject({ isPaused: false, speed: 1 });
    quarter.getState().setSpeed(0.25);
    quarter.getState().tick(4);
    expect(quarter.getState().snapshot).toEqual(normal.getState().snapshot);
  });

  it('starts a new race with a provided seed and replays it deterministically', () => {
    raceStore.getState().restart('store-replay-seed');
    raceStore.getState().tick(2);
    const firstSnapshot = raceStore.getState().snapshot;
    const firstFeed = raceStore.getState().eventFeed;

    raceStore.getState().replaySeed();
    raceStore.getState().tick(2);

    expect(raceStore.getState().snapshot).toEqual(firstSnapshot);
    expect(raceStore.getState().eventFeed).toEqual(firstFeed);
  });

  it('creates a new seed when restarted without one', () => {
    const previousSeed = raceStore.getState().snapshot.seed;

    raceStore.getState().restart();

    expect(raceStore.getState().snapshot.seed).not.toBe(previousSeed);
    expect(raceStore.getState().snapshot.tick).toBe(0);
  });

  it('hydrates and persists versioned presentation preferences', () => {
    const values = new Map<string, string>();
    values.set(PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 1,
      muted: false,
      reducedMotion: false,
      labels: false,
      effects: false,
      quality: 'mobile',
      cameraMode: 'cockpit',
    }));
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    };
    const store = createRaceStore(DEFAULT_RACE_CONFIG, { storage, prefersReducedMotion: true });

    expect(store.getState()).toMatchObject({
      audioMuted: false,
      reducedMotion: false,
      labelsEnabled: false,
      effectsEnabled: false,
      qualityMode: 'mobile',
      cameraMode: 'cockpit',
    });

    store.getState().toggleLabels();
    store.getState().toggleEffects();
    store.getState().toggleAudio();
    store.getState().toggleReducedMotion();
    store.getState().setQualityMode('high');
    store.getState().setCameraMode('overhead');

    expect(JSON.parse(values.get(PREFERENCES_STORAGE_KEY)!)).toEqual({
      version: 1,
      muted: true,
      reducedMotion: true,
      labels: true,
      effects: true,
      quality: 'high',
      cameraMode: 'overhead',
      explain: true,
    });
  });

  it('uses system reduced motion until explicitly overridden and ignores unsafe storage', () => {
    const brokenStorage = {
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      setItem: vi.fn(() => { throw new Error('blocked'); }),
    };
    const store = createRaceStore(DEFAULT_RACE_CONFIG, { storage: brokenStorage, prefersReducedMotion: true });

    expect(store.getState().reducedMotion).toBe(true);
    expect(() => store.getState().toggleReducedMotion()).not.toThrow();
    expect(store.getState().reducedMotion).toBe(false);

    const invalidStorage = { getItem: () => '{not-json', setItem: () => undefined };
    expect(createRaceStore(DEFAULT_RACE_CONFIG, { storage: invalidStorage, prefersReducedMotion: false }).getState())
      .toMatchObject({ audioMuted: true, labelsEnabled: true, effectsEnabled: true, qualityMode: 'auto', cameraMode: 'broadcast' });
  });

  it('follows system motion changes only while the user preference is unset', () => {
    const store = createRaceStore(DEFAULT_RACE_CONFIG, { storage: null, prefersReducedMotion: false });

    store.getState().updateSystemReducedMotion(true);
    expect(store.getState().reducedMotion).toBe(true);
    store.getState().updateSystemReducedMotion(false);
    expect(store.getState().reducedMotion).toBe(false);

    store.getState().updateSystemReducedMotion(true);
    store.getState().toggleReducedMotion();
    expect(store.getState().reducedMotion).toBe(false);
    store.getState().updateSystemReducedMotion(true);
    expect(store.getState().reducedMotion).toBe(false);
    store.getState().updateSystemReducedMotion(false);
    expect(store.getState().reducedMotion).toBe(false);
  });
});
