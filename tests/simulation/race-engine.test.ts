import { DEFAULT_RACE_CONFIG } from '../../src/domain/race-config';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import type { RaceEvent, RaceState } from '../../src/simulation/events';
import { calculateFuelFactor, calculateTargetPace } from '../../src/simulation/pace';
import {
  createRaceEngine,
  type DriverController,
} from '../../src/simulation/race-engine';
import { SHANGHAI_TRACK } from '../../src/track/shanghai-track';

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

  it('models the pace gain from burning fuel over a race distance', () => {
    const fullTank = calculateFuelFactor(0, 56);
    const halfTank = calculateFuelFactor(28, 56);
    const nearEmpty = calculateFuelFactor(56, 56);

    expect(fullTank).toBeLessThan(1);
    expect(halfTank).toBeGreaterThan(fullTank);
    expect(nearEmpty).toBeGreaterThan(halfTank);
    expect(calculateTargetPace({
      basePace: 1,
      consistencyNoise: 0,
      tireGrip: 1,
      fuelFactor: nearEmpty,
      trafficFactor: 1,
      slipstreamFactor: 1,
      damageFactor: 1,
      flagFactor: 1,
    })).toBeGreaterThan(calculateTargetPace({
      basePace: 1,
      consistencyNoise: 0,
      tireGrip: 1,
      fuelFactor: fullTank,
      trafficFactor: 1,
      slipstreamFactor: 1,
      damageFactor: 1,
      flagFactor: 1,
    }));
  });
});

describe('RaceEngine', () => {
  it('initializes every car in a seeded qualifying order on the track grid', () => {
    const snapshot = createRaceEngine(DEFAULT_RACE_CONFIG, SHANGHAI_TRACK, DRIVERS_2026).snapshot();
    const replay = createRaceEngine(DEFAULT_RACE_CONFIG, SHANGHAI_TRACK, DRIVERS_2026).snapshot();
    const alternate = createRaceEngine(
      { ...DEFAULT_RACE_CONFIG, seed: 'alternate-qualifying' },
      SHANGHAI_TRACK,
      DRIVERS_2026,
    ).snapshot();

    expect(snapshot.phase).toBe('grid');
    expect(snapshot.tick).toBe(0);
    expect(snapshot.cars).toHaveLength(14);
    expect(snapshot.cars.map((car) => car.driverId)).toEqual(
      replay.cars.map((car) => car.driverId),
    );
    expect(snapshot.cars.map((car) => car.driverId)).not.toEqual(
      alternate.cars.map((car) => car.driverId),
    );
    expect(new Set(snapshot.cars.map((car) => car.driverId))).toEqual(
      new Set(DRIVERS_2026.map((driver) => driver.id)),
    );
    expect(snapshot.cars.map((car) => car.position)).toEqual(
      Array.from({ length: 14 }, (_, index) => index + 1),
    );
    snapshot.cars.forEach((car, index) => {
      expect(car.distance).toBe(SHANGHAI_TRACK.gridSlots[index]?.distance);
      expect(car.lateralOffset).toBe(SHANGHAI_TRACK.gridSlots[index]?.lateral);
      expect(car.status).toBe('running');
    });
  });

  it('keeps qualifying ratings influential despite seeded variation', () => {
    const elite = {
      ...DRIVERS_2026[0]!,
      id: 'elite-qualifier',
      ratings: { ...DRIVERS_2026[0]!.ratings, qualifying: 1 },
    };
    const novice = {
      ...DRIVERS_2026[1]!,
      id: 'novice-qualifier',
      ratings: { ...DRIVERS_2026[1]!.ratings, qualifying: 0 },
    };

    for (let seed = 0; seed < 20; seed += 1) {
      const cars = createRaceEngine(
        { ...DEFAULT_RACE_CONFIG, seed: `ratings-${seed}` },
        SHANGHAI_TRACK,
        [novice, elite],
      ).snapshot().cars;
      expect(cars.map((car) => car.driverId)).toEqual(['elite-qualifier', 'novice-qualifier']);
    }
  });

  it('produces identical state for identical seeds and elapsed time', () => {
    const a = createRaceEngine(DEFAULT_RACE_CONFIG, SHANGHAI_TRACK, DRIVERS_2026);
    const b = createRaceEngine(DEFAULT_RACE_CONFIG, SHANGHAI_TRACK, DRIVERS_2026);

    a.advance(20);
    b.advance(20);

    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.drainEvents()).toEqual(b.drainEvents());
  });

  it('is independent of presentation-time chunking', () => {
    const whole = createRaceEngine(DEFAULT_RACE_CONFIG, SHANGHAI_TRACK, DRIVERS_2026);
    const chunked = createRaceEngine(DEFAULT_RACE_CONFIG, SHANGHAI_TRACK, DRIVERS_2026);

    whole.advance(20);
    for (let index = 0; index < 200; index += 1) chunked.advance(0.1);

    expect(chunked.snapshot()).toEqual(whole.snapshot());
    expect(chunked.drainEvents()).toEqual(whole.drainEvents());
  });

  it('evolves each car fuel factor as the field burns fuel', () => {
    const engine = createRaceEngine(
      { ...DEFAULT_RACE_CONFIG, incidents: false, safetyCars: false },
      SHANGHAI_TRACK,
      [DRIVERS_2026[0]!],
    );
    const initialFuelFactor = engine.snapshot().cars[0]!.fuelFactor;

    engine.advance(120);

    expect(engine.snapshot().cars[0]!.fuelFactor).toBeGreaterThan(initialFuelFactor);
  });

  it('allows one driver pace controller to replace the default AI decision', () => {
    const decisions: number[] = [];
    const controlledDriver = DRIVERS_2026[0]!;
    const controller: DriverController = {
      decidePace(input) {
        decisions.push(input.suggestedPace);
        return { paceFactor: 0.5 };
      },
    };
    const engine = createRaceEngine(
      { ...DEFAULT_RACE_CONFIG, incidents: false, safetyCars: false },
      SHANGHAI_TRACK,
      [controlledDriver],
      { controllers: { [controlledDriver.id]: controller } },
    );

    engine.advance(0.01);

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toBeGreaterThan(0.5);
    expect(engine.snapshot().cars[0]!.speed).toBeCloseTo(0.5 / 76.2);
  });

  it('returns isolated, frozen snapshots and copied event batches', () => {
    const engine = createRaceEngine(DEFAULT_RACE_CONFIG, SHANGHAI_TRACK, DRIVERS_2026);
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
      SHANGHAI_TRACK,
      DRIVERS_2026,
    );
    engine.runToFinish();
    const events = engine.drainEvents();
    const sectorEvents = events.filter((event) => event.type === 'sector');
    const lapEvents = events.filter((event) => event.type === 'lap');
    const finishEvents = events.filter((event) => event.type === 'finish');

    expect(events.filter((event) => event.type === 'start')).toHaveLength(1);
    expect(new Set(sectorEvents.map((event) => event.sector))).toEqual(new Set([1, 2, 3]));
    // Cars that are lapped complete fewer tours than the leader, so assert the
    // real invariant: every driver appears, the leader runs the full distance,
    // and nobody is dropped more than a couple of laps.
    const lapsPerDriver = new Map<string, number>();
    for (const event of lapEvents) {
      lapsPerDriver.set(event.driverId, (lapsPerDriver.get(event.driverId) ?? 0) + 1);
    }
    expect(lapsPerDriver.size).toBe(DRIVERS_2026.length);
    expect(Math.max(...lapsPerDriver.values())).toBe(DEFAULT_RACE_CONFIG.laps);
    for (const laps of lapsPerDriver.values()) {
      expect(laps).toBeGreaterThanOrEqual(DEFAULT_RACE_CONFIG.laps - 2);
    }
    expect(finishEvents).toHaveLength(DRIVERS_2026.length);
    // Pit laps include Shanghai's long pit lane, so the outer band is wide; the
    // median must still land in a realistic green-lap window for a 5.3 km lap.
    expect(lapEvents.every((event) => event.lapTime > 60 && event.lapTime < 175)).toBe(true);
    const sortedLapTimes = lapEvents.map((event) => event.lapTime).sort((left, right) => left - right);
    const medianLapTime = sortedLapTimes[Math.floor(sortedLapTimes.length / 2)]!;
    expect(medianLapTime).toBeGreaterThan(70);
    expect(medianLapTime).toBeLessThan(100);
  });

  it('finishes and classifies all 14 cars after 56 laps', () => {
    const engine = createRaceEngine(
      { ...DEFAULT_RACE_CONFIG, incidents: false, safetyCars: false },
      SHANGHAI_TRACK,
      DRIVERS_2026,
    );

    engine.runToFinish();
    const snapshot = engine.snapshot();

    expect(snapshot.phase).toBe('finished');
    expect(snapshot.cars).toHaveLength(14);
    expect(snapshot.cars.every((car) => car.status === 'finished')).toBe(true);
    expect(snapshot.cars.every((car) => car.lap === DEFAULT_RACE_CONFIG.laps)).toBe(true);
    expect(snapshot.cars.map((car) => car.position)).toEqual(
      Array.from({ length: 14 }, (_, index) => index + 1),
    );
    expect(snapshot.cars.map((car) => car.status === 'finished' ? car.finishPosition : -1)).toEqual(
      Array.from({ length: 14 }, (_, index) => index + 1),
    );
  });

  it('does not advance after the race is finished', () => {
    const engine = createRaceEngine(DEFAULT_RACE_CONFIG, SHANGHAI_TRACK, DRIVERS_2026);
    engine.runToFinish();
    const finished = engine.snapshot();

    engine.advance(30);

    expect(engine.snapshot()).toEqual(finished);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid presentation time %s',
    (presentationSeconds) => {
      const engine = createRaceEngine(DEFAULT_RACE_CONFIG, SHANGHAI_TRACK, DRIVERS_2026);
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
