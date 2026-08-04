import { DEFAULT_RACE_CONFIG } from '../../src/domain/race-config';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import type { RaceConfig } from '../../src/domain/race-types';
import { evaluateIncident } from '../../src/simulation/incidents';
import { evaluateOvertake } from '../../src/simulation/overtakes';
import { createPrng } from '../../src/simulation/prng';
import { calculateSafetyCarCatchupFactor, createRaceEngine } from '../../src/simulation/race-engine';
import { createStrategy } from '../../src/simulation/strategy';
import { updateTire } from '../../src/simulation/tires';
import { MONACO_TRACK } from '../../src/track/monaco-track';

const raceConfig = (seed: string, overrides: Partial<RaceConfig> = {}): RaceConfig => ({
  ...DEFAULT_RACE_CONFIG,
  seed,
  ...overrides,
});

function maximumActiveGap(cars: ReturnType<ReturnType<typeof createRaceEngine>['snapshot']>['cars']): number {
  const active = cars
    .filter((car) => car.status === 'running')
    .map((car) => car.lap + car.distance)
    .sort((left, right) => right - left);
  let maximum = 0;
  for (let index = 1; index < active.length; index += 1) {
    maximum = Math.max(maximum, active[index - 1]! - active[index]!);
  }
  return maximum;
}

describe('race rule primitives', () => {
  it('reduces grip as a tire exceeds its useful life', () => {
    const fresh = updateTire({ compound: 'soft', wear: 0.1, temperature: 0.8 }, 1, 0.8);
    const worn = updateTire({ compound: 'soft', wear: 0.85, temperature: 0.8 }, 1, 0.8);

    expect(worn.grip).toBeLessThan(fresh.grip);
    expect(worn.wear).toBeGreaterThanOrEqual(0.85);
  });

  it('creates the same bounded strategy from the same seed', () => {
    const driver = DRIVERS_2026[0]!;
    const first = createStrategy(driver, 'sunny', createPrng('strategy'));
    const replay = createStrategy(driver, 'sunny', createPrng('strategy'));

    expect(first).toEqual(replay);
    expect(first.stops).toHaveLength(first.stopCount);
    expect(first.stops.every((stop) => stop.window[0] > 0 && stop.window[1] < 78)).toBe(true);
  });

  it('replays the same overtake decision from the same seed', () => {
    const input = {
      paceAdvantage: 0.08,
      gapSeconds: 0.4,
      passingZone: true,
      attackerSkill: 0.9,
      defenderSkill: 0.7,
    };

    expect(evaluateOvertake(input, createPrng('pass'))).toEqual(
      evaluateOvertake(input, createPrng('pass')),
    );
    expect(evaluateOvertake({ ...input, passingZone: false }, createPrng('pass'))).toBe('none');
  });

  it('replays the same incident decision from the same seed', () => {
    const input = {
      proximitySeconds: 0.2,
      relativeSpeed: 0.08,
      weather: 'rain' as const,
      consistency: 0.7,
      incidentAvoidance: 0.7,
      reliability: 0.8,
      damage: 0.2,
    };

    expect(evaluateIncident(input, createPrng('incident'))).toEqual(
      evaluateIncident(input, createPrng('incident')),
    );
  });
});

describe('integrated race rules', () => {
  it('changes compound during a pit stop and charges meaningful time', () => {
    const engine = createRaceEngine(
      raceConfig('pit-stop', { incidents: false, safetyCars: false }),
      MONACO_TRACK,
      [DRIVERS_2026[0]!],
    );

    engine.runToFinish();
    const events = engine.drainEvents();
    const laps = events.filter((event) => event.type === 'lap');
    const tireChanges = events.filter((event) => event.type === 'tire-change');

    expect(events.some((event) => event.type === 'pit-entry')).toBe(true);
    expect(events.some((event) => event.type === 'pit-exit')).toBe(true);
    expect(tireChanges.length).toBeGreaterThanOrEqual(1);
    expect(tireChanges[0]?.compound).not.toBe('medium');
    expect(Math.max(...laps.map((event) => event.lapTime)) - Math.min(...laps.map((event) => event.lapTime)))
      .toBeGreaterThan(12);
  });

  it('keeps a retired car terminal for the remainder of the race', () => {
    const engine = createRaceEngine(
      raceConfig('rules-0'),
      MONACO_TRACK,
      DRIVERS_2026,
    );

    engine.runToFinish();
    const snapshot = engine.snapshot();
    const events = engine.drainEvents();
    const retirement = events.find((event) => event.type === 'retirement');

    expect(retirement).toBeDefined();
    if (retirement?.type !== 'retirement') return;
    const retired = snapshot.cars.find((car) => car.driverId === retirement.driverId);
    expect(retired?.status).toBe('retired');
    expect(events.some((event) => event.type === 'finish' && event.driverId === retirement.driverId)).toBe(false);
  });

  it('emits safety-car transitions and compresses active-car gaps', () => {
    const engine = createRaceEngine(raceConfig('safety-review-1'), MONACO_TRACK, DRIVERS_2026);
    let gapAtDeployment: number | undefined;
    let compressedGap: number | undefined;

    for (let sample = 0; sample < 1_600; sample += 1) {
      engine.advance(0.25);
      const deployed = engine.drainEvents().some(
        (event) => event.type === 'flag' && event.flag === 'safety-car',
      );
      if (deployed) {
        gapAtDeployment = maximumActiveGap(engine.snapshot().cars);
        engine.advance(0.8);
        compressedGap = maximumActiveGap(engine.snapshot().cars);
        break;
      }
    }

    const flags = engine.snapshot().events.filter((event) => event.type === 'flag');
    expect(flags.some((event) => event.flag === 'safety-car')).toBe(true);
    expect(gapAtDeployment).toBeDefined();
    expect(compressedGap).toBeDefined();
    expect(compressedGap!).toBeLessThan(gapAtDeployment!);

    engine.runToFinish();
    const completedFlags = engine.snapshot().events.filter((event) => event.type === 'flag');
    expect(completedFlags.some((event) => event.flag === 'yellow')).toBe(true);
    expect(completedFlags.some((event) => event.flag === 'green')).toBe(true);
  });

  it('does not bunch pit cars or skip authoritative timing boundaries under the safety car', () => {
    expect(calculateSafetyCarCatchupFactor({
      gapSeconds: 4,
      hasCarAhead: true,
      safetyCar: 'deployed',
      pitState: 'stopped',
      penaltyTicks: 0,
    })).toBe(1);
    expect(calculateSafetyCarCatchupFactor({
      gapSeconds: 4,
      hasCarAhead: true,
      safetyCar: 'deployed',
      pitState: 'track',
      penaltyTicks: 10,
    })).toBe(1);

    const engine = createRaceEngine(raceConfig('review-1'), MONACO_TRACK, DRIVERS_2026);
    engine.runToFinish();
    const lapEvents = engine.snapshot().events.filter((event) => event.type === 'lap');
    for (const car of engine.snapshot().cars) {
      if (car.status !== 'finished') continue;
      expect(lapEvents.filter((event) => event.driverId === car.driverId)).toHaveLength(78);
    }
  });

  it('updates each battle participant at most once per ordering checkpoint', () => {
    const engine = createRaceEngine(raceConfig('review-1'), MONACO_TRACK, DRIVERS_2026);
    engine.runToFinish();
    const participantsByTick = new Map<number, string[]>();

    for (const event of engine.snapshot().events) {
      const participants = event.type === 'overtake'
        ? [event.attackerId, event.defenderId]
        : event.type === 'incident' && event.driverIds.length === 2 ? event.driverIds : [];
      if (participants.length === 0) continue;
      participantsByTick.set(event.tick, [
        ...(participantsByTick.get(event.tick) ?? []),
        ...participants,
      ]);
    }

    for (const participants of participantsByTick.values()) {
      expect(new Set(participants).size).toBe(participants.length);
    }
  });

  it('restores racing lines outside passing zones and whenever racing is neutralized', () => {
    const engine = createRaceEngine(raceConfig('review-1'), MONACO_TRACK, DRIVERS_2026);
    const passingZones = MONACO_TRACK.zones.filter((zone) => zone.kind === 'passing');
    const isPassingZone = (distance: number) => passingZones.some((zone) => (
      zone.start <= zone.end
        ? distance >= zone.start && distance <= zone.end
        : distance >= zone.start || distance <= zone.end
    ));

    for (let sample = 0; sample < 4_000 && engine.snapshot().phase !== 'finished'; sample += 1) {
      engine.advance(0.1);
      const snapshot = engine.snapshot();
      for (const car of snapshot.cars) {
        if (car.status !== 'running' || car.pitState !== 'track') continue;
        if (snapshot.flag !== 'green' || !isPassingZone(car.distance)) {
          expect(car.targetLine).toBe('racing');
        }
      }
    }
  });

  it('preserves race invariants across 200 seeds', { timeout: 120_000 }, () => {
    const winners = new Set<string>();
    // A representative front-to-midfield pack retains the full 78-lap rules
    // while keeping this 200-race stress test bounded for local and CI runs.
    const invariantDrivers = DRIVERS_2026.slice(0, 8);

    for (let seed = 0; seed < 200; seed += 1) {
      const engine = createRaceEngine(raceConfig(`invariant-${seed}`), MONACO_TRACK, invariantDrivers);
      engine.runToFinish();
      const snapshot = engine.snapshot();
      const events = engine.drainEvents();
      const retired = new Set(
        events.filter((event) => event.type === 'retirement').map((event) => event.driverId),
      );
      const finishers = snapshot.cars.filter((car) => car.status === 'finished');
      const winner = finishers.find((car) => car.finishPosition === 1);

      expect(snapshot.phase, `seed ${seed} did not terminate`).toBe('finished');
      expect(new Set(snapshot.cars.map((car) => car.position)).size).toBe(snapshot.cars.length);
      expect(new Set(finishers.map((car) => car.finishPosition)).size).toBe(finishers.length);
      expect(events.filter((event) => event.type === 'lap').every((event) => event.lapTime >= 0)).toBe(true);
      expect(events.some((event) => event.type === 'finish' && retired.has(event.driverId))).toBe(false);
      expect(winner).toBeDefined();
      if (winner) winners.add(winner.driverId);
    }

    expect(winners.size).toBeGreaterThanOrEqual(2);
  });
});
