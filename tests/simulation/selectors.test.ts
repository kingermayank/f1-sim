import { getClassification, getIntervals } from '../../src/simulation/selectors';
import type { CarState, RaceState } from '../../src/simulation/events';

function carBase(driverId: string) {
  return {
    driverId,
    lap: 0,
    distance: 0,
    lateralOffset: 0,
    speed: 0,
    tire: { compound: 'medium' as const, wear: 0, temperature: 0 },
    fuelFactor: 1,
    damage: 0,
    pitState: 'track' as const,
    position: 1,
    timing: { lastLap: null, bestLap: null, totalTime: 0 },
    targetLine: 'racing' as const,
  };
}

function runningCar(driverId: string, overrides: Partial<Omit<CarState, 'driverId' | 'status'>> = {}): CarState {
  return { ...carBase(driverId), status: 'running', ...overrides } as CarState;
}

function finishedCar(driverId: string, finishPosition: number, position = finishPosition): CarState {
  return { ...carBase(driverId), status: 'finished', finishPosition, position };
}

function retiredCar(driverId: string, retirementTick: number): CarState {
  return { ...carBase(driverId), status: 'retired', retirementTick };
}

// @ts-expect-error Finished cars must carry immutable finishing metadata.
const malformedFinishedCar: CarState = { ...carBase('missing-finish'), status: 'finished' };
// @ts-expect-error Retired cars must carry immutable retirement metadata.
const malformedRetiredCar: CarState = { ...carBase('missing-retirement'), status: 'retired' };
void malformedFinishedCar;
void malformedRetiredCar;

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

  expect(getClassification({ cars } as never).map((entry) => entry.driverId)).toEqual(['b', 'a', 'c']);
});

it('orders finishers by position, then running cars, then retirees by retirement tick', () => {
  const classification = getClassification(state([
    runningCar('runner', { lap: 10, distance: 0.9 }),
    finishedCar('second', 2, 99),
    finishedCar('first', 1, 98),
    retiredCar('late-retirement', 30),
    retiredCar('early-retirement', 12),
  ]));

  expect(classification.map((entry) => entry.driverId)).toEqual([
    'first', 'second', 'runner', 'late-retirement', 'early-retirement',
  ]);
});

it('derives leader intervals without mutating car state', () => {
  const race = state([
    runningCar('leader', { lap: 8, distance: 0.5, speed: 0.02 }),
    runningCar('follower', { lap: 8, distance: 0.3, speed: 0.01 }),
  ]);
  const originalCars = structuredClone(race.cars);

  const intervals = getIntervals(race);
  expect(intervals.get('leader')).toBe(0);
  expect(intervals.get('follower')).toBeCloseTo(20);
  expect(race.cars).toEqual(originalCars);
});
