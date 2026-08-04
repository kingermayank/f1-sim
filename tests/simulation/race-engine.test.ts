import { DEFAULT_RACE_CONFIG } from '../../src/domain/race-config';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import type { RaceEvent, RaceState } from '../../src/simulation/events';
import { calculateTargetPace } from '../../src/simulation/pace';
import { createRaceEngine } from '../../src/simulation/race-engine';
import { MONACO_TRACK } from '../../src/track/monaco-track';

describe('calculateTargetPace', () => {
  it('combines every pace factor', () => {
    expect(calculateTargetPace({
      basePace: 1,
      consistencyNoise: 0.02,
      tireGrip: 0.99,
      fuelFactor: 0.98,
      trafficFactor: 0.97,
      slipstreamFactor: 1.01,
      damageFactor: 0.96,
      flagFactor: 1,
    })).toBeCloseTo(0.99 * 0.98 * 0.97 * 1.01 * 0.96 * 1.02);
  });

  it('keeps target pace above the minimum', () => {
    expect(calculateTargetPace({
      basePace: 0,
      consistencyNoise: -1,
      tireGrip: 0,
      fuelFactor: 0,
      trafficFactor: 0,
      slipstreamFactor: 0,
      damageFactor: 0,
      flagFactor: 0,
    })).toBe(0.15);
  });
});

describe('RaceEngine', () => {
  it('initializes all cars from the track grid in stable grid order', () => {
    const snapshot = createRaceEngine(DEFAULT_RACE_CONFIG, MONACO_TRACK, DRIVERS_2026).snapshot();

    expect(snapshot.phase).toBe('grid');
    expect(snapshot.tick).toBe(0);
    expect(snapshot.cars).toHaveLength(22);
    expect(snapshot.cars.map((car) => car.position)).toEqual(
      Array.from({ length: 22 }, (_, index) => index + 1),
    );
    snapshot.cars.forEach((car, index) => {
      expect(car.driverId).toBe(DRIVERS_2026[index]?.id);
      expect(car.distance).toBe(MONACO_TRACK.gridSlots[index]?.distance);
      expect(car.lateralOffset).toBe(MONACO_TRACK.gridSlots[index]?.lateral);
      expect(car.status).toBe('running');
    });
  });

  it('produces identical state for identical seeds and elapsed time', () => {
    const a = createRaceEngine(DEFAULT_RACE_CONFIG, MONACO_TRACK, DRIVERS_2026);
    const b = createRaceEngine(DEFAULT_RACE_CONFIG, MONACO_TRACK, DRIVERS_2026);

    a.advance(20);
    b.advance(20);

    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.drainEvents()).toEqual(b.drainEvents());
  });

  it('is independent of presentation-time chunking', () => {
    const whole = createRaceEngine(DEFAULT_RACE_CONFIG, MONACO_TRACK, DRIVERS_2026);
    const chunked = createRaceEngine(DEFAULT_RACE_CONFIG, MONACO_TRACK, DRIVERS_2026);

    whole.advance(20);
    for (let index = 0; index < 200; index += 1) chunked.advance(0.1);

    expect(chunked.snapshot()).toEqual(whole.snapshot());
    expect(chunked.drainEvents()).toEqual(whole.drainEvents());
  });

  it('returns isolated, frozen snapshots and copied event batches', () => {
    const engine = createRaceEngine(DEFAULT_RACE_CONFIG, MONACO_TRACK, DRIVERS_2026);
    engine.advance(10);

    const first = engine.snapshot();
    const second = engine.snapshot();
    expect(first).not.toBe(second);
    expect(first.cars).not.toBe(second.cars);
    expect(first.events).not.toBe(second.events);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.cars)).toBe(true);
    expect(Object.isFrozen(first.events)).toBe(true);
    expect(Object.isFrozen(first.cars[0]?.tire)).toBe(true);

    const drained = engine.drainEvents();
    const originalType = engine.snapshot().events[0]?.type;
    if (drained[0]) drained[0] = { type: 'start', tick: -1 };
    expect(engine.snapshot().events[0]?.type).toBe(originalType);
    expect(engine.drainEvents()).toEqual([]);
  });

  it('emits start, sector, lap, and finish events with realistic lap timing', () => {
    const engine = createRaceEngine(
      { ...DEFAULT_RACE_CONFIG, incidents: false, safetyCars: false },
      MONACO_TRACK,
      DRIVERS_2026,
    );
    engine.runToFinish();
    const events = engine.drainEvents();
    const sectorEvents = events.filter((event) => event.type === 'sector');
    const lapEvents = events.filter((event) => event.type === 'lap');
    const finishEvents = events.filter((event) => event.type === 'finish');

    expect(events.filter((event) => event.type === 'start')).toHaveLength(1);
    expect(new Set(sectorEvents.map((event) => event.sector))).toEqual(new Set([1, 2, 3]));
    expect(lapEvents).toHaveLength(22 * DEFAULT_RACE_CONFIG.laps);
    expect(finishEvents).toHaveLength(22);
    // Pit laps include Monaco's roughly 20-second lane loss.
    expect(lapEvents.every((event) => event.lapTime > 60 && event.lapTime < 130)).toBe(true);
  });

  it('finishes and classifies all 22 cars after 78 laps', () => {
    const engine = createRaceEngine(
      { ...DEFAULT_RACE_CONFIG, incidents: false, safetyCars: false },
      MONACO_TRACK,
      DRIVERS_2026,
    );

    engine.runToFinish();
    const snapshot = engine.snapshot();

    expect(snapshot.phase).toBe('finished');
    expect(snapshot.cars).toHaveLength(22);
    expect(snapshot.cars.every((car) => car.status === 'finished')).toBe(true);
    expect(snapshot.cars.every((car) => car.lap === DEFAULT_RACE_CONFIG.laps)).toBe(true);
    expect(snapshot.cars.map((car) => car.position)).toEqual(
      Array.from({ length: 22 }, (_, index) => index + 1),
    );
    expect(snapshot.cars.map((car) => car.status === 'finished' ? car.finishPosition : -1)).toEqual(
      Array.from({ length: 22 }, (_, index) => index + 1),
    );
  });

  it('does not advance after the race is finished', () => {
    const engine = createRaceEngine(DEFAULT_RACE_CONFIG, MONACO_TRACK, DRIVERS_2026);
    engine.runToFinish();
    const finished = engine.snapshot();

    engine.advance(30);

    expect(engine.snapshot()).toEqual(finished);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid presentation time %s',
    (presentationSeconds) => {
      const engine = createRaceEngine(DEFAULT_RACE_CONFIG, MONACO_TRACK, DRIVERS_2026);
      expect(() => engine.advance(presentationSeconds)).toThrow(RangeError);
    },
  );
});

// Compile-time checks: callers receive readonly state arrays, while drained
// batches are detached values that can be consumed normally.
function assertReadonlyArrays(readonlyState: Readonly<RaceState>, drainedEvents: RaceEvent[]): void {
  // @ts-expect-error Snapshot car arrays are readonly.
  readonlyState.cars.push(readonlyState.cars[0]);
  // @ts-expect-error Snapshot event arrays are readonly.
  readonlyState.events.push({ type: 'start', tick: 0 });
  void drainedEvents;
}
void assertReadonlyArrays;
