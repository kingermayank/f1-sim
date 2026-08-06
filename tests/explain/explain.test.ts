import { describe, expect, it } from 'vitest';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import { explainEvent, explainFeed } from '../../src/explain/explain';
import { GLOSSARY, lookupTerm } from '../../src/explain/glossary';
import type { CarState, RaceEvent, RaceState } from '../../src/simulation/events';

function car(driverId: string, overrides: Partial<CarState> = {}): CarState {
  return {
    driverId,
    lap: 10,
    distance: 0.4,
    lateralOffset: 0,
    speed: 70,
    tire: { compound: 'medium', wear: 0.3, temperature: 0.5 },
    fuelFactor: 0.5,
    damage: 0,
    pitState: 'track',
    pitProgress: 0,
    position: 1,
    timing: { lastLap: 95, bestLap: 94, totalTime: 950 },
    targetLine: 'racing',
    status: 'running',
    ...overrides,
  } as CarState;
}

function state(cars: CarState[], events: RaceEvent[] = []): RaceState {
  return {
    seed: 'test', tick: 100, elapsedSeconds: 100, phase: 'racing',
    flag: 'green', weather: 'sunny', safetyCar: 'none',
    cars, events,
  };
}

describe('explainEvent', () => {
  it('explains a pit entry by tyre cost rather than restating the stop', () => {
    const result = explainEvent(
      { type: 'pit-entry', tick: 1, driverId: 'verstappen' },
      state([car('verstappen', { tire: { compound: 'medium', wear: 0.82, temperature: 0.6 } })]),
    );
    expect(result).not.toBeNull();
    // The reason must name the cause, not merely repeat that a stop happened.
    expect(result!.reason).toMatch(/degradation|worn|82%/i);
    expect(result!.terms).toContain('degradation');
  });

  it('distinguishes a harder tyre change from a softer one', () => {
    const toHard = explainEvent(
      { type: 'tire-change', tick: 1, driverId: 'norris', compound: 'hard' },
      state([car('norris', { tire: { compound: 'soft', wear: 0.7, temperature: 0.6 } })]),
    );
    const toSoft = explainEvent(
      { type: 'tire-change', tick: 1, driverId: 'norris', compound: 'soft' },
      state([car('norris', { tire: { compound: 'hard', wear: 0.7, temperature: 0.6 } })]),
    );
    expect(toHard!.reason).toMatch(/last(s)? longer|fewer stop/i);
    expect(toSoft!.reason).toMatch(/quicker|faster/i);
  });

  it('attributes an overtake to fresher tyres when the gap in wear is large', () => {
    const result = explainEvent(
      { type: 'overtake', tick: 1, attackerId: 'leclerc', defenderId: 'alonso', position: 3 },
      state([
        car('leclerc', { tire: { compound: 'soft', wear: 0.1, temperature: 0.5 } }),
        car('alonso', { tire: { compound: 'hard', wear: 0.8, temperature: 0.5 } }),
      ]),
    );
    expect(result!.reason).toMatch(/fresher|grip/i);
  });

  it('attributes an overtake to DRS when tyre wear is comparable', () => {
    const result = explainEvent(
      { type: 'overtake', tick: 1, attackerId: 'leclerc', defenderId: 'alonso', position: 3 },
      state([
        car('leclerc', { tire: { compound: 'medium', wear: 0.4, temperature: 0.5 } }),
        car('alonso', { tire: { compound: 'medium', wear: 0.42, temperature: 0.5 } }),
      ]),
    );
    expect(result!.reason).toMatch(/DRS/);
    expect(result!.terms).toContain('DRS');
  });

  it('explains what a safety car does to the race rather than that it appeared', () => {
    const result = explainEvent({ type: 'flag', tick: 1, flag: 'safety-car' }, state([car('verstappen')]));
    expect(result!.reason).toMatch(/bunch|reshuffl|costs far less/i);
  });

  it('covers every event type that a viewer would ask about', () => {
    const base = state([car('verstappen'), car('norris')]);
    const events: RaceEvent[] = [
      { type: 'start', tick: 0 },
      { type: 'pit-entry', tick: 1, driverId: 'verstappen' },
      { type: 'tire-change', tick: 2, driverId: 'verstappen', compound: 'hard' },
      { type: 'overtake', tick: 3, attackerId: 'norris', defenderId: 'verstappen', position: 1 },
      { type: 'flag', tick: 4, flag: 'yellow' },
      { type: 'incident', tick: 5, driverIds: ['norris'], severity: 'major' },
      { type: 'retirement', tick: 6, driverId: 'norris', reason: 'mechanical' },
      { type: 'weather', tick: 7, weather: 'rain' },
      { type: 'finish', tick: 8, driverId: 'verstappen', position: 1 },
    ];
    for (const event of events) {
      const result = explainEvent(event, base);
      expect(result, `${event.type} should be explained`).not.toBeNull();
      expect(result!.headline.length).toBeGreaterThan(0);
      expect(result!.reason.length).toBeGreaterThan(20);
    }
  });

  it('stays silent on routine timing events', () => {
    const base = state([car('verstappen')]);
    expect(explainEvent({ type: 'lap', tick: 1, driverId: 'verstappen', lap: 3, lapTime: 95 }, base)).toBeNull();
    expect(explainEvent({ type: 'sector', tick: 1, driverId: 'verstappen', lap: 3, sector: 2, sectorTime: 30 }, base)).toBeNull();
  });

  it('uses real driver names so the feed reads naturally', () => {
    const verstappen = DRIVERS_2026.find((driver) => driver.id === 'verstappen')!;
    const result = explainEvent({ type: 'retirement', tick: 1, driverId: 'verstappen', reason: 'engine' }, state([car('verstappen')]));
    expect(result!.headline).toContain(verstappen.name);
  });
});

describe('explainFeed', () => {
  it('returns newest first and skips unexplained events', () => {
    const base = state([car('verstappen')], [
      { type: 'start', tick: 0 },
      { type: 'lap', tick: 1, driverId: 'verstappen', lap: 1, lapTime: 95 },
      { type: 'flag', tick: 2, flag: 'safety-car' },
    ]);
    const feed = explainFeed(base);
    expect(feed).toHaveLength(2);
    expect(feed[0].event.type).toBe('flag');
    expect(feed[1].event.type).toBe('start');
  });

  it('honours the limit', () => {
    const events: RaceEvent[] = Array.from({ length: 30 }, (_, index) => (
      { type: 'flag', tick: index, flag: 'yellow' } as RaceEvent
    ));
    expect(explainFeed(state([car('verstappen')], events), 5)).toHaveLength(5);
  });
});

describe('glossary', () => {
  it('defines every term the explanations reference', () => {
    const base = state([
      car('leclerc', { tire: { compound: 'soft', wear: 0.1, temperature: 0.5 } }),
      car('alonso', { tire: { compound: 'hard', wear: 0.85, temperature: 0.5 } }),
    ]);
    const events: RaceEvent[] = [
      { type: 'start', tick: 0 },
      { type: 'pit-entry', tick: 1, driverId: 'leclerc' },
      { type: 'tire-change', tick: 2, driverId: 'leclerc', compound: 'hard' },
      { type: 'overtake', tick: 3, attackerId: 'leclerc', defenderId: 'alonso', position: 1 },
      { type: 'flag', tick: 4, flag: 'safety-car' },
      { type: 'flag', tick: 5, flag: 'yellow' },
      { type: 'incident', tick: 6, driverIds: ['alonso'], severity: 'major' },
      { type: 'weather', tick: 7, weather: 'rain' },
      { type: 'finish', tick: 8, driverId: 'leclerc', position: 1 },
    ];
    for (const event of events) {
      for (const term of explainEvent(event, base)?.terms ?? []) {
        expect(lookupTerm(term), `glossary is missing "${term}"`).toBeDefined();
      }
    }
  });

  it('gives every entry a short and a long definition', () => {
    for (const entry of GLOSSARY) {
      expect(entry.short.length).toBeGreaterThan(10);
      expect(entry.long.length).toBeGreaterThan(40);
    }
  });
});
