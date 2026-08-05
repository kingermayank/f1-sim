import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RACE_CONFIG } from '../../src/domain/race-config';
import { raceStore } from '../../src/store/race-store';

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
    raceStore.getState().setSpeed(8);
    raceStore.getState().setSpeed(3 as never);
    expect(raceStore.getState().speed).toBe(8);

    raceStore.getState().setCameraMode('cockpit');
    raceStore.getState().setCameraMode('sidecar' as never);
    expect(raceStore.getState().cameraMode).toBe('cockpit');
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
});
