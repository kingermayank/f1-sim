import type { Driver, RaceConfig } from '../domain/race-types';
import type { TrackDefinition } from '../track/track-types';
import type { CarState, FinishedCarState, RaceEvent, RaceState, RunningCarState } from './events';
import { calculateTargetPace } from './pace';
import { createPrng } from './prng';
import { getClassification } from './selectors';

const TICK_SECONDS = 0.1;
const TICKS_PER_SECOND = 1 / TICK_SECONDS;
const REFERENCE_LAP_SECONDS = 76.2;
const MAX_FINISH_TICKS = 2_000_000;
const TICK_ROUNDING_TOLERANCE = 1e-9;

type MutableRaceState = Omit<RaceState, 'cars' | 'events'> & {
  cars: CarState[];
  events: RaceEvent[];
};

interface TimingProgress {
  lapStartedAt: number;
  sectorStartedAt: number;
}

interface FinishCandidate {
  carIndex: number;
  crossingTime: number;
  previousPosition: number;
  driverId: string;
}

export interface RaceEngine {
  advance(presentationSeconds: number): void;
  snapshot(): Readonly<RaceState>;
  drainEvents(): RaceEvent[];
  runToFinish(): void;
}

function cloneEvent(event: RaceEvent): RaceEvent {
  return event.type === 'incident' ? { ...event, driverIds: [...event.driverIds] } : { ...event };
}

function freezeEvent(event: RaceEvent): RaceEvent {
  if (event.type === 'incident') Object.freeze(event.driverIds);
  return Object.freeze(event);
}

function cloneCar(car: CarState): CarState {
  return {
    ...car,
    tire: { ...car.tire },
    timing: { ...car.timing },
  };
}

function freezeCar(car: CarState): CarState {
  Object.freeze(car.tire);
  Object.freeze(car.timing);
  return Object.freeze(car);
}

function immutableSnapshot(state: MutableRaceState): Readonly<RaceState> {
  const cars = state.cars.map((car) => freezeCar(cloneCar(car)));
  const events = state.events.map((event) => freezeEvent(cloneEvent(event)));
  Object.freeze(cars);
  Object.freeze(events);
  return Object.freeze({ ...state, cars, events });
}

function initialCar(driver: Driver, gridPosition: number, track: TrackDefinition): RunningCarState {
  const slot = track.gridSlots[gridPosition];
  if (!slot) throw new RangeError(`Track ${track.id} has no grid slot ${gridPosition + 1}`);

  return {
    driverId: driver.id,
    // A wrapped grid slot is physically just before the timing line. Keeping it
    // on the preceding lap makes completed-distance ordering match the grid.
    lap: slot.distance > 0.5 ? -1 : 0,
    distance: slot.distance,
    lateralOffset: slot.lateral,
    speed: 0,
    tire: { compound: 'medium', wear: 0, temperature: 0.8 },
    fuelFactor: 1,
    damage: 0,
    pitState: 'track',
    position: gridPosition + 1,
    timing: { lastLap: null, bestLap: null, totalTime: 0 },
    status: 'running',
    targetLine: 'racing',
  };
}

export function createRaceEngine(
  config: RaceConfig,
  track: TrackDefinition,
  drivers: readonly Driver[],
): RaceEngine {
  if (drivers.length === 0) throw new RangeError('A race requires at least one driver');
  if (track.gridSlots.length < drivers.length) {
    throw new RangeError(`Track ${track.id} only has ${track.gridSlots.length} grid slots for ${drivers.length} drivers`);
  }

  const prng = createPrng(config.seed);
  const driverById = new Map(drivers.map((driver) => [driver.id, driver]));
  const timingProgress = new Map<string, TimingProgress>();
  const queuedEvents: RaceEvent[] = [];
  const state: MutableRaceState = {
    seed: config.seed,
    tick: 0,
    elapsedSeconds: 0,
    phase: 'grid',
    flag: 'green',
    weather: config.weather,
    safetyCar: 'none',
    cars: drivers.map((driver, index) => initialCar(driver, index, track)),
    events: [],
  };

  for (const car of state.cars) {
    timingProgress.set(car.driverId, { lapStartedAt: 0, sectorStartedAt: 0 });
  }

  const presentationTicksPerSecond = (
    config.laps * REFERENCE_LAP_SECONDS * TICKS_PER_SECOND
  ) / (config.presentationMinutes * 60);
  let pendingTicks = 0;

  function emit(event: RaceEvent): void {
    state.events.push(event);
    queuedEvents.push(event);
  }

  function moveRunningCar(
    car: RunningCarState,
    carIndex: number,
    tickStartedAt: number,
    finishCandidates: FinishCandidate[],
  ): CarState {
    const driver = driverById.get(car.driverId);
    if (!driver) throw new Error(`Missing driver data for ${car.driverId}`);
    const timing = timingProgress.get(car.driverId);
    if (!timing) throw new Error(`Missing timing state for ${car.driverId}`);

    const noiseRange = (1 - driver.ratings.consistency) * 0.012;
    const paceFactor = calculateTargetPace({
      basePace: 0.92 + driver.ratings.pace * 0.08,
      consistencyNoise: prng.range(-noiseRange, noiseRange),
      tireGrip: 1,
      fuelFactor: car.fuelFactor,
      trafficFactor: 1,
      slipstreamFactor: 1,
      damageFactor: 1 - car.damage,
      flagFactor: state.flag === 'green' ? 1 : state.flag === 'yellow' ? 0.7 : 0.55,
    });
    const speed = paceFactor / REFERENCE_LAP_SECONDS;
    const startDistance = car.distance;
    const endDistance = startDistance + speed * TICK_SECONDS;
    const tickEndedAt = tickStartedAt + TICK_SECONDS;

    for (let index = 0; index < track.sectors.length; index += 1) {
      const boundary = track.sectors[index];
      if (car.lap < 0 || boundary <= startDistance || boundary > endDistance) continue;
      const crossingTime = tickStartedAt + (boundary - startDistance) / speed;
      const sector = (index + 1) as 1 | 2 | 3;
      emit({
        type: 'sector',
        tick: state.tick,
        driverId: car.driverId,
        lap: car.lap + 1,
        sector,
        sectorTime: crossingTime - timing.sectorStartedAt,
      });
      timing.sectorStartedAt = crossingTime;
    }

    if (endDistance < 1) {
      return {
        ...car,
        distance: endDistance,
        speed,
        timing: { ...car.timing, totalTime: tickEndedAt },
      };
    }

    const crossingTime = tickStartedAt + (1 - startDistance) / speed;
    const nextLap = car.lap + 1;
    if (nextLap === 0) {
      timing.lapStartedAt = crossingTime;
      timing.sectorStartedAt = crossingTime;
    }

    const lapTime = crossingTime - timing.lapStartedAt;
    if (nextLap >= 1) {
      emit({ type: 'lap', tick: state.tick, driverId: car.driverId, lap: nextLap, lapTime });
    }

    const nextTiming = {
      lastLap: nextLap >= 1 ? lapTime : car.timing.lastLap,
      bestLap: nextLap >= 1
        ? Math.min(car.timing.bestLap ?? Number.POSITIVE_INFINITY, lapTime)
        : car.timing.bestLap,
      totalTime: crossingTime,
    };
    timing.lapStartedAt = crossingTime;
    timing.sectorStartedAt = crossingTime;

    if (nextLap >= config.laps) {
      const finished: FinishedCarState = {
        ...car,
        lap: config.laps,
        distance: 0,
        speed: 0,
        timing: nextTiming,
        status: 'finished',
        finishPosition: 0,
      };
      finishCandidates.push({
        carIndex,
        crossingTime,
        previousPosition: car.position,
        driverId: car.driverId,
      });
      return finished;
    }

    return {
      ...car,
      lap: nextLap,
      distance: endDistance - 1,
      speed,
      timing: { ...nextTiming, totalTime: tickEndedAt },
    };
  }

  function step(): void {
    if (state.phase === 'finished') return;

    state.tick += 1;
    if (state.phase === 'grid') {
      state.phase = 'racing';
      emit({ type: 'start', tick: state.tick });
    }

    const tickStartedAt = state.elapsedSeconds;
    const finishCandidates: FinishCandidate[] = [];
    const movedCars = state.cars.map((car, index) => (
      car.status === 'running'
        ? moveRunningCar(car, index, tickStartedAt, finishCandidates)
        : car
    ));

    const alreadyFinished = movedCars.filter(
      (car) => car.status === 'finished' && car.finishPosition > 0,
    ).length;
    finishCandidates.sort((left, right) => (
      left.crossingTime - right.crossingTime
      || left.previousPosition - right.previousPosition
      || left.driverId.localeCompare(right.driverId)
    ));
    finishCandidates.forEach((candidate, index) => {
      const car = movedCars[candidate.carIndex];
      if (car?.status !== 'finished') throw new Error(`Finish candidate ${candidate.driverId} is not finished`);
      const finishPosition = alreadyFinished + index + 1;
      movedCars[candidate.carIndex] = { ...car, finishPosition, position: finishPosition };
      emit({ type: 'finish', tick: state.tick, driverId: candidate.driverId, position: finishPosition });
    });

    state.cars = getClassification({ cars: movedCars }).map((car, index) => ({
      ...car,
      position: index + 1,
    }));
    state.elapsedSeconds = state.tick * TICK_SECONDS;
    if (state.cars.every((car) => car.status !== 'running')) state.phase = 'finished';
  }

  return {
    advance(presentationSeconds: number): void {
      if (!Number.isFinite(presentationSeconds) || presentationSeconds < 0) {
        throw new RangeError('Presentation time must be a finite, non-negative number');
      }
      if (state.phase === 'finished' || presentationSeconds === 0) return;

      pendingTicks += presentationSeconds * presentationTicksPerSecond;
      const steps = Math.floor(pendingTicks + TICK_ROUNDING_TOLERANCE);
      pendingTicks -= steps;
      for (let index = 0; index < steps; index += 1) {
        step();
        if (state.cars.every((car) => car.status !== 'running')) break;
      }
    },

    snapshot(): Readonly<RaceState> {
      return immutableSnapshot(state);
    },

    drainEvents(): RaceEvent[] {
      const events = queuedEvents.map(cloneEvent);
      queuedEvents.length = 0;
      return events;
    },

    runToFinish(): void {
      let steps = 0;
      while (state.phase !== 'finished' && steps < MAX_FINISH_TICKS) {
        step();
        steps += 1;
      }
      if (state.phase !== 'finished') {
        throw new Error(`Race did not finish within ${MAX_FINISH_TICKS} ticks`);
      }
    },
  };
}
