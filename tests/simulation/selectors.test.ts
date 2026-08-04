import { getClassification, getIntervals } from '../../src/simulation/selectors';
import type { CarState, RaceState } from '../../src/simulation/events';

function car(overrides: Partial<CarState> & Pick<CarState, 'driverId'>): CarState {
  return {
    lap: 0,
    distance: 0,
    lateralOffset: 0,
    speed: 0,
    tire: { compound: 'medium', wear: 0, temperature: 0 },
    fuelFactor: 1,
    damage: 0,
    pitState: 'track',
    position: 1,
    timing: { lastLap: null, bestLap: null, totalTime: 0 },
    status: 'running',
    targetLine: 'racing',
    ...overrides,
    driverId: overrides.driverId,
  };
}

function state(cars: CarState[]): RaceState {
  return {
    seed: 'test',
    tick: 0,
    elapsedSeconds: 0,
    phase: 'racing',
    flag: 'green',
    weather: 'sunny',
    safetyCar: 'none',
    cars,
    events: [],
  };
}

it('orders active cars by completed distance and retirees behind finishers', () => {
  const cars = [
    { driverId: 'a', lap: 2, distance: 0.2, status: 'running' },
    { driverId: 'b', lap: 2, distance: 0.8, status: 'running' },
    { driverId: 'c', lap: 4, distance: 0.9, status: 'retired' },
  ] as CarState[];

  expect(getClassification({ cars } as RaceState).map((entry) => entry.driverId)).toEqual(['b', 'a', 'c']);
});

it('orders finishers by position, then running cars, then retirees by retirement tick', () => {
  const classification = getClassification(state([
    car({ driverId: 'runner', lap: 10, distance: 0.9 }),
    car({ driverId: 'second', status: 'finished', position: 2 }),
    car({ driverId: 'first', status: 'finished', position: 1 }),
    car({ driverId: 'late-retirement', status: 'retired', retirementTick: 30 }),
    car({ driverId: 'early-retirement', status: 'retired', retirementTick: 12 }),
  ]));

  expect(classification.map((entry) => entry.driverId)).toEqual([
    'first', 'second', 'runner', 'late-retirement', 'early-retirement',
  ]);
});

it('derives leader intervals without mutating car state', () => {
  const race = state([
    car({ driverId: 'leader', lap: 8, distance: 0.5, speed: 0.02 }),
    car({ driverId: 'follower', lap: 8, distance: 0.3, speed: 0.01 }),
  ]);
  const originalCars = structuredClone(race.cars);

  const intervals = getIntervals(race);
  expect(intervals.get('leader')).toBe(0);
  expect(intervals.get('follower')).toBeCloseTo(20);
  expect(race.cars).toEqual(originalCars);
});
