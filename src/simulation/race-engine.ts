import type { Driver, RaceConfig, TireCompound } from '../domain/race-types';
import type { TrackDefinition, TrackZone } from '../track/track-types';
import type {
  CarState,
  FinishedCarState,
  PitState,
  RaceEvent,
  RaceState,
  RetiredCarState,
  RunningCarState,
  SafetyCarState,
} from './events';
import { evaluateIncident } from './incidents';
import { evaluateOvertake } from './overtakes';
import { calculateFuelFactor, calculateTargetPace } from './pace';
import { createPrng } from './prng';
import { getClassification } from './selectors';
import { createStrategy, shouldPit, type RaceStrategy } from './strategy';
import { updateTire } from './tires';
import { createWeatherSchedule, weatherTrackTemperature } from './weather';

export const TICK_SECONDS = 0.1;
const TICKS_PER_SECOND = 1 / TICK_SECONDS;
const REFERENCE_LAP_SECONDS = 76.2;
const MAX_FINISH_TICKS = 2_000_000;
const TICK_ROUNDING_TOLERANCE = 1e-9;
const OVERTAKE_CHECK_TICKS = 10;
const SAFETY_CAR_DEPLOY_TICKS = 100;
const SAFETY_CAR_RETURN_TICKS = 500;
const SAFETY_CAR_END_TICKS = 600;

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

interface PitProgress {
  totalTicks: number;
  remainingTicks: number;
  compound: TireCompound;
  changed: boolean;
}

interface DriverRuntime {
  strategy: RaceStrategy;
  nextStop: number;
  pit: PitProgress | null;
  penaltyTicks: number;
}

interface RaceContext {
  ahead: RunningCarState | undefined;
  gapSeconds: number;
}

export interface DriverPaceDecisionInput {
  driver: Readonly<Driver>;
  car: Readonly<RunningCarState>;
  race: Readonly<Pick<RaceState, 'tick' | 'elapsedSeconds' | 'phase' | 'flag' | 'weather' | 'safetyCar'>>;
  context: Readonly<{ gapSeconds: number; hasCarAhead: boolean }>;
  /** The complete rules-based AI pace before an injected controller adjusts it. */
  suggestedPace: number;
}

export interface DriverPaceDecision {
  paceFactor: number;
}

export interface DriverController {
  decidePace(input: DriverPaceDecisionInput): DriverPaceDecision;
}

export interface RaceEngineOptions {
  /** A controller can replace the default AI for any individual driver. */
  controllers?: Readonly<Partial<Record<string, DriverController>>>;
  defaultController?: DriverController;
}

export const DEFAULT_AI_DRIVER_CONTROLLER: DriverController = Object.freeze({
  decidePace: ({ suggestedPace }: DriverPaceDecisionInput) => ({ paceFactor: suggestedPace }),
});

export interface RaceEngine {
  advance(presentationSeconds: number): void;
  /**
   * How far presentation time has run into the next tick, in [0, 1). A
   * renderer drawing between ticks can carry each car forward by
   * `speed × TICK_SECONDS × tickFraction()` instead of holding it at the
   * last tick, which at ten ticks a second reads as stutter.
   */
  tickFraction(): number;
  snapshot(): Readonly<RaceState>;
  drainEvents(): RaceEvent[];
  runToFinish(): void;
}

export interface SafetyCarCatchupInput {
  gapSeconds: number;
  hasCarAhead: boolean;
  safetyCar: SafetyCarState;
  pitState: PitState;
  penaltyTicks: number;
}

/** A pace multiplier only; position and timing still advance through normal movement. */
export function calculateSafetyCarCatchupFactor(input: SafetyCarCatchupInput): number {
  if (
    (input.safetyCar !== 'deploying' && input.safetyCar !== 'deployed')
    || !input.hasCarAhead
    || input.pitState !== 'track'
    || input.penaltyTicks > 0
    || input.gapSeconds <= 0.35
  ) return 1;
  return Math.min(1.35, 1 + (input.gapSeconds - 0.35) * 0.08);
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

function completedDistance(car: CarState): number {
  return car.lap + car.distance;
}

function qualifyingOrder(seed: string, drivers: readonly Driver[]): Driver[] {
  return [...drivers]
    .map((driver) => {
      const qualifyingPrng = createPrng(`${seed}:qualifying:${driver.id}`);
      const ratingScore = (
        driver.ratings.qualifying * 0.88
        + driver.ratings.pace * 0.08
        + driver.ratings.consistency * 0.04
      );
      return { driver, score: ratingScore + qualifyingPrng.range(-0.06, 0.06) };
    })
    .sort((left, right) => right.score - left.score || left.driver.id.localeCompare(right.driver.id))
    .map(({ driver }) => driver);
}

function atZone(distance: number, zone: TrackZone): boolean {
  return zone.start <= zone.end
    ? distance >= zone.start && distance <= zone.end
    : distance >= zone.start || distance <= zone.end;
}

function initialCar(
  driver: Driver,
  gridPosition: number,
  track: TrackDefinition,
  compound: TireCompound,
): RunningCarState {
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
    tire: { compound, wear: 0, temperature: compound === 'wet' ? 0.62 : 0.78 },
    fuelFactor: calculateFuelFactor(0, 78),
    damage: 0,
    pitState: 'track',
    pitProgress: 0,
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
  options: RaceEngineOptions = {},
): RaceEngine {
  if (drivers.length === 0) throw new RangeError('A race requires at least one driver');
  if (track.gridSlots.length < drivers.length) {
    throw new RangeError(`Track ${track.id} only has ${track.gridSlots.length} grid slots for ${drivers.length} drivers`);
  }

  const prng = createPrng(config.seed);
  const grid = qualifyingOrder(config.seed, drivers);
  const driverById = new Map(drivers.map((driver) => [driver.id, driver]));
  const runtimeByDriver = new Map<string, DriverRuntime>();
  for (const driver of drivers) {
    runtimeByDriver.set(driver.id, {
      strategy: createStrategy(driver, config.weather, createPrng(`${config.seed}:strategy:${driver.id}`)),
      nextStop: 0,
      pit: null,
      penaltyTicks: 0,
    });
  }

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
    cars: grid.map((driver, index) => {
      const runtime = runtimeByDriver.get(driver.id);
      if (!runtime) throw new Error(`Missing strategy for ${driver.id}`);
      return initialCar(driver, index, track, runtime.strategy.initialCompound);
    }),
    events: [],
  };

  for (const car of state.cars) {
    timingProgress.set(car.driverId, { lapStartedAt: 0, sectorStartedAt: 0 });
  }

  const presentationTicksPerSecond = (
    config.laps * REFERENCE_LAP_SECONDS * TICKS_PER_SECOND
  ) / (config.presentationMinutes * 60);
  const passingZones = track.zones.filter((zone) => zone.kind === 'passing');
  const weatherSchedule = createWeatherSchedule(
    config.weather,
    config.laps,
    createPrng(`${config.seed}:weather`),
    config.dynamicWeather ?? config.weather !== 'sunny',
  );
  let nextWeatherTransition = 0;
  let pendingTicks = 0;
  let safetyCarTicks = 0;
  let yellowTicks = 0;

  function emit(event: RaceEvent): void {
    state.events.push(event);
    queuedEvents.push(event);
  }

  function deploySafetyCar(): void {
    if (!config.safetyCars || state.safetyCar !== 'none') return;
    state.safetyCar = 'deploying';
    state.flag = 'safety-car';
    safetyCarTicks = 0;
    yellowTicks = 0;
    emit({ type: 'flag', tick: state.tick, flag: 'safety-car' });
  }

  function deployYellow(): void {
    if (state.flag !== 'green') return;
    state.flag = 'yellow';
    yellowTicks = 80;
    emit({ type: 'flag', tick: state.tick, flag: 'yellow' });
  }

  function updateFlags(): void {
    if (state.safetyCar !== 'none') {
      safetyCarTicks += 1;
      if (state.safetyCar === 'deploying' && safetyCarTicks >= SAFETY_CAR_DEPLOY_TICKS) {
        state.safetyCar = 'deployed';
      } else if (state.safetyCar === 'deployed' && safetyCarTicks >= SAFETY_CAR_RETURN_TICKS) {
        state.safetyCar = 'returning';
        state.flag = 'yellow';
        emit({ type: 'flag', tick: state.tick, flag: 'yellow' });
      } else if (state.safetyCar === 'returning' && safetyCarTicks >= SAFETY_CAR_END_TICKS) {
        state.safetyCar = 'none';
        state.flag = 'green';
        safetyCarTicks = 0;
        emit({ type: 'flag', tick: state.tick, flag: 'green' });
      }
      return;
    }

    if (yellowTicks > 0) {
      yellowTicks -= 1;
      if (yellowTicks === 0) {
        state.flag = 'green';
        emit({ type: 'flag', tick: state.tick, flag: 'green' });
      }
    }
  }

  function updateWeather(): void {
    const leaderLap = state.cars.reduce((maximum, car) => Math.max(maximum, car.lap), 0);
    while (
      nextWeatherTransition < weatherSchedule.length
      && leaderLap >= weatherSchedule[nextWeatherTransition]!.lap
    ) {
      const transition = weatherSchedule[nextWeatherTransition]!;
      nextWeatherTransition += 1;
      if (transition.weather === state.weather) continue;
      state.weather = transition.weather;
      emit({ type: 'weather', tick: state.tick, weather: transition.weather });
    }
  }

  function buildRaceContexts(): Map<string, RaceContext> {
    const active = getClassification({ cars: state.cars }).filter(
      (car): car is RunningCarState => car.status === 'running',
    );
    const contexts = new Map<string, RaceContext>();
    active.forEach((car, index) => {
      const ahead = active[index - 1];
      const gapDistance = ahead ? Math.max(0, completedDistance(ahead) - completedDistance(car)) : Number.POSITIVE_INFINITY;
      contexts.set(car.driverId, {
        ahead,
        gapSeconds: ahead && car.speed > 0 ? gapDistance / car.speed : Number.POSITIVE_INFINITY,
      });
    });
    return contexts;
  }

  function startPitStop(car: RunningCarState, runtime: DriverRuntime, compound: TireCompound): RunningCarState {
    const driver = driverById.get(car.driverId);
    if (!driver) throw new Error(`Missing driver data for ${car.driverId}`);
    const totalTicks = Math.round((19 + (1 - driver.ratings.pitExecution) * 5 + prng.range(-0.7, 0.7)) / TICK_SECONDS);
    runtime.pit = { totalTicks, remainingTicks: totalTicks, compound, changed: false };
    emit({ type: 'pit-entry', tick: state.tick, driverId: car.driverId });
    return { ...car, pitState: 'entry', pitProgress: 0, targetLine: 'pit' };
  }

  function movePitCar(car: RunningCarState, runtime: DriverRuntime, tickEndedAt: number): RunningCarState {
    const pit = runtime.pit;
    if (!pit) return car;
    pit.remainingTicks -= 1;
    const progress = 1 - pit.remainingTicks / pit.totalTicks;
    let tire = { ...car.tire, temperature: Math.max(0.5, car.tire.temperature - 0.0015) };

    if (!pit.changed && progress >= 0.48) {
      pit.changed = true;
      tire = { compound: pit.compound, wear: 0, temperature: 0.58 };
      emit({ type: 'tire-change', tick: state.tick, driverId: car.driverId, compound: pit.compound });
    }

    if (pit.remainingTicks <= 0) {
      runtime.pit = null;
      runtime.nextStop += 1;
      emit({ type: 'pit-exit', tick: state.tick, driverId: car.driverId });
      return {
        ...car,
        speed: 0,
        tire,
        pitState: 'track',
        pitProgress: 0,
        targetLine: 'racing',
        timing: { ...car.timing, totalTime: tickEndedAt },
      };
    }

    const pitState = progress < 0.2 ? 'lane' : progress < 0.75 ? 'stopped' : 'exit';
    return {
      ...car,
      speed: 0,
      tire,
      pitState,
      pitProgress: Math.min(1, Math.max(0, progress)),
      targetLine: 'pit',
      timing: { ...car.timing, totalTime: tickEndedAt },
    };
  }

  function handleIncident(
    car: RunningCarState,
    nextLap: number,
    nextTiming: RunningCarState['timing'],
    context: RaceContext,
    runtime: DriverRuntime,
  ): RunningCarState | RetiredCarState {
    if (!config.incidents || nextLap < 1 || nextLap >= config.laps) return { ...car, timing: nextTiming };
    const driver = driverById.get(car.driverId);
    if (!driver) throw new Error(`Missing driver data for ${car.driverId}`);
    const decision = evaluateIncident({
      proximitySeconds: context.gapSeconds,
      relativeSpeed: context.ahead ? car.speed - context.ahead.speed : 0,
      weather: state.weather,
      consistency: driver.ratings.consistency,
      incidentAvoidance: driver.ratings.incidentAvoidance,
      reliability: driver.ratings.reliability,
      damage: car.damage,
    }, prng);
    if (decision.kind === 'none' || decision.severity === null) return { ...car, timing: nextTiming };

    emit({ type: 'incident', tick: state.tick, driverIds: [car.driverId], severity: decision.severity });
    const damage = Math.min(1, car.damage + decision.damage);
    if (decision.safetyCar) deploySafetyCar();
    else if (decision.severity === 'major') deployYellow();

    if (decision.retire || damage >= 0.95) {
      emit({ type: 'retirement', tick: state.tick, driverId: car.driverId, reason: decision.kind });
      return {
        ...car,
        speed: 0,
        damage,
        timing: nextTiming,
        status: 'retired',
        retirementTick: state.tick,
        targetLine: 'racing',
        pitState: 'track',
        pitProgress: 0,
      };
    }

    runtime.penaltyTicks = Math.max(runtime.penaltyTicks, Math.round(decision.timeLossSeconds / TICK_SECONDS));
    return { ...car, damage, timing: nextTiming };
  }

  function moveRunningCar(
    originalCar: RunningCarState,
    carIndex: number,
    tickStartedAt: number,
    finishCandidates: FinishCandidate[],
    context: RaceContext,
  ): CarState {
    const driver = driverById.get(originalCar.driverId);
    if (!driver) throw new Error(`Missing driver data for ${originalCar.driverId}`);
    const runtime = runtimeByDriver.get(originalCar.driverId);
    if (!runtime) throw new Error(`Missing runtime data for ${originalCar.driverId}`);
    const timing = timingProgress.get(originalCar.driverId);
    if (!timing) throw new Error(`Missing timing state for ${originalCar.driverId}`);
    const tickEndedAt = tickStartedAt + TICK_SECONDS;

    let car = {
      ...originalCar,
      fuelFactor: calculateFuelFactor(Math.max(0, completedDistance(originalCar)), config.laps),
    };
    if (runtime.pit) return movePitCar(car, runtime, tickEndedAt);
    if (runtime.penaltyTicks > 0) {
      runtime.penaltyTicks -= 1;
      return {
        ...car,
        speed: 0,
        timing: { ...car.timing, totalTime: tickEndedAt },
        targetLine: 'racing',
      };
    }

    const trackTemperature = weatherTrackTemperature(state.weather);
    const currentTire = updateTire(car.tire, 0, trackTemperature);
    const plannedStop = runtime.strategy.stops[runtime.nextStop];
    if (
      plannedStop
      && car.lap >= 0
      && atZone(car.distance, { start: track.pitEntry, end: 0.995, kind: 'speed-limit' })
      && shouldPit(plannedStop, {
        lap: car.lap,
        safetyCar: state.safetyCar !== 'none',
        trafficSeconds: context.gapSeconds,
        tireWear: currentTire.wear,
        tireGrip: currentTire.grip,
        damage: car.damage,
      })
    ) {
      car = startPitStop(car, runtime, plannedStop.compound);
      return movePitCar(car, runtime, tickEndedAt);
    }

    const weatherGrip = state.weather === 'rain'
      ? car.tire.compound === 'wet' ? 1 : car.tire.compound === 'intermediate' ? 1.025 : 0.72
      : car.tire.compound === 'wet' ? 0.82 : car.tire.compound === 'intermediate' ? 0.88 : 1;
    const noiseRange = (1 - driver.ratings.consistency) * 0.012;
    const safetyCarCatchupFactor = calculateSafetyCarCatchupFactor({
      gapSeconds: context.gapSeconds,
      hasCarAhead: context.ahead !== undefined,
      safetyCar: state.safetyCar,
      pitState: car.pitState,
      penaltyTicks: runtime.penaltyTicks,
    });
    const suggestedPace = calculateTargetPace({
      // Pace spread across the field. At 0.92 + pace * 0.08 the whole grid sat
      // within about 1.5% of each other, so fourteen cars stayed packed into a
      // fraction of a lap and rendered as one long train no matter how the
      // renderer spaced them. A wider spread lets the field string out around
      // the circuit the way a real race does.
      basePace: 0.80 + driver.ratings.pace * 0.20,
      consistencyNoise: prng.range(-noiseRange, noiseRange),
      tireGrip: currentTire.grip * weatherGrip,
      fuelFactor: car.fuelFactor,
      // Dirty air. A 1% penalty was too weak to matter, so a following car
      // simply sat on the gearbox of the one ahead and the pair travelled as a
      // single unit. Scaling the penalty with proximity makes a trapped car
      // genuinely lose ground, which is both what really happens and what makes
      // the field string out instead of running nose to tail.
      trafficFactor: context.gapSeconds < 1.6
        ? 0.955 + Math.min(context.gapSeconds, 1.6) * 0.028
        : 1,
      slipstreamFactor: context.gapSeconds < 0.75 && state.flag === 'green' ? 1.004 : 1,
      damageFactor: 1 - car.damage * 0.55,
      flagFactor: (state.flag === 'green' ? 1 : state.flag === 'yellow' ? 0.7 : 0.55)
        * safetyCarCatchupFactor,
    });
    const controller = options.controllers?.[car.driverId]
      ?? options.defaultController
      ?? DEFAULT_AI_DRIVER_CONTROLLER;
    const decision = controller.decidePace({
      driver,
      car,
      race: {
        tick: state.tick,
        elapsedSeconds: state.elapsedSeconds,
        phase: state.phase,
        flag: state.flag,
        weather: state.weather,
        safetyCar: state.safetyCar,
      },
      context: { gapSeconds: context.gapSeconds, hasCarAhead: context.ahead !== undefined },
      suggestedPace,
    });
    if (!Number.isFinite(decision.paceFactor) || decision.paceFactor < 0) {
      throw new RangeError(`Controller for ${car.driverId} returned an invalid pace factor`);
    }
    const paceFactor = decision.paceFactor;
    const speed = paceFactor / REFERENCE_LAP_SECONDS;
    const startDistance = car.distance;
    const endDistance = startDistance + speed * TICK_SECONDS;

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

    const tireDistance = speed * TICK_SECONDS * (1.08 - driver.ratings.tireManagement * 0.16);
    const evolvedTire = updateTire(car.tire, tireDistance, trackTemperature);
    const tire = {
      compound: evolvedTire.compound,
      wear: evolvedTire.wear,
      temperature: evolvedTire.temperature,
    };

    if (endDistance < 1) {
      return {
        ...car,
        distance: endDistance,
        speed,
        tire,
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
        tire,
        timing: nextTiming,
        status: 'finished',
        finishPosition: 0,
        targetLine: 'racing',
        lateralOffset: 0,
        pitState: 'track',
        pitProgress: 0,
      };
      finishCandidates.push({
        carIndex,
        crossingTime,
        previousPosition: car.position,
        driverId: car.driverId,
      });
      return finished;
    }

    const advanced: RunningCarState = {
      ...car,
      lap: nextLap,
      distance: endDistance - 1,
      speed,
      tire,
      timing: { ...nextTiming, totalTime: tickEndedAt },
    };
    return handleIncident(advanced, nextLap, advanced.timing, context, runtime);
  }

  function setCompletedDistance(car: RunningCarState, value: number): RunningCarState {
    const lap = Math.floor(value);
    return { ...car, lap, distance: value - lap };
  }

  function applyOvertakes(cars: CarState[]): CarState[] {
    const result = cars.map((car) => {
      if (car.status !== 'running' || car.pitState !== 'track') return car;
      // Still in the grid boxes: keep the staggered slots. The start/finish is
      // inside a DRS zone, so without this they jump onto an attack line at
      // lights out.
      if (car.lap < 0 || car.distance >= 0.94) return car;
      const inPassingZone = passingZones.some((zone) => atZone(car.distance, zone));
      return state.flag !== 'green' || !inPassingZone
        ? { ...car, targetLine: 'racing' as const, lateralOffset: 0 }
        : car;
    });
    if (state.flag !== 'green' || state.tick % OVERTAKE_CHECK_TICKS !== 0) return result;
    const indexByDriver = new Map(result.map((car, index) => [car.driverId, index]));
    const active = getClassification({ cars: result }).filter(
      (car): car is RunningCarState => car.status === 'running' && car.pitState === 'track',
    );

    // Alternate disjoint adjacent pairs so a middle car cannot be attacker and
    // defender in the same ordering checkpoint.
    const firstAttackerIndex = Math.floor(state.tick / OVERTAKE_CHECK_TICKS) % 2 === 0 ? 1 : 2;
    for (let orderIndex = firstAttackerIndex; orderIndex < active.length; orderIndex += 2) {
      const defender = active[orderIndex - 1]!;
      const attacker = active[orderIndex]!;
      if (defender.lap >= config.laps - 1 && defender.distance > 0.995) continue;
      const attackerDriver = driverById.get(attacker.driverId);
      const defenderDriver = driverById.get(defender.driverId);
      if (!attackerDriver || !defenderDriver) continue;
      const gapDistance = completedDistance(defender) - completedDistance(attacker);
      const gapSeconds = attacker.speed > 0 ? gapDistance / attacker.speed : Number.POSITIVE_INFINITY;
      const paceAdvantage = (
        attackerDriver.ratings.pace - defenderDriver.ratings.pace
        + Math.max(0, (attacker.speed - defender.speed) * REFERENCE_LAP_SECONDS)
      );
      const decision = evaluateOvertake({
        paceAdvantage,
        gapSeconds,
        passingZone: passingZones.some((zone) => (
          atZone(attacker.distance, zone) && atZone(defender.distance, zone)
        )),
        attackerSkill: attackerDriver.ratings.overtaking,
        defenderSkill: defenderDriver.ratings.defending,
      }, prng);
      const attackerIndex = indexByDriver.get(attacker.driverId);
      const defenderIndex = indexByDriver.get(defender.driverId);
      if (attackerIndex === undefined || defenderIndex === undefined) continue;

      if (decision === 'none' || decision === 'failed') {
        result[attackerIndex] = { ...attacker, targetLine: 'racing', lateralOffset: 0 };
        result[defenderIndex] = { ...defender, targetLine: 'racing', lateralOffset: 0 };
      } else if (decision === 'attack') {
        result[attackerIndex] = { ...attacker, targetLine: 'attack', lateralOffset: -1.2 };
        result[defenderIndex] = { ...defender, targetLine: 'defend', lateralOffset: 1.1 };
      } else if (decision === 'contact') {
        result[attackerIndex] = {
          ...attacker,
          damage: Math.min(1, attacker.damage + 0.08),
          targetLine: 'racing',
          lateralOffset: 0,
        };
        result[defenderIndex] = {
          ...defender,
          damage: Math.min(1, defender.damage + 0.05),
          targetLine: 'racing',
          lateralOffset: 0,
        };
        emit({
          type: 'incident',
          tick: state.tick,
          driverIds: [attacker.driverId, defender.driverId],
          severity: 'minor',
        });
      } else if (decision === 'pass') {
        result[attackerIndex] = setCompletedDistance(
          { ...attacker, targetLine: 'racing', lateralOffset: 0 },
          completedDistance(defender) + 0.00008,
        );
        result[defenderIndex] = { ...defender, targetLine: 'racing', lateralOffset: 0 };
        emit({
          type: 'overtake',
          tick: state.tick,
          attackerId: attacker.driverId,
          defenderId: defender.driverId,
          position: defender.position,
        });
      }
    }
    return result;
  }

  function step(): void {
    if (state.phase === 'finished') return;

    state.tick += 1;
    if (state.phase === 'grid') {
      state.phase = 'racing';
      emit({ type: 'start', tick: state.tick });
    }

    updateWeather();

    const tickStartedAt = state.elapsedSeconds;
    const finishCandidates: FinishCandidate[] = [];
    const contexts = buildRaceContexts();
    let movedCars = state.cars.map((car, index) => (
      car.status === 'running'
        ? moveRunningCar(
            car,
            index,
            tickStartedAt,
            finishCandidates,
            contexts.get(car.driverId) ?? { ahead: undefined, gapSeconds: Number.POSITIVE_INFINITY },
          )
        : car
    ));

    movedCars = applyOvertakes(movedCars);
    const alreadyFinished = movedCars.filter(
      (car) => car.status === 'finished' && car.finishPosition > 0,
    ).length;
    finishCandidates.sort((left, right) => (
      left.crossingTime - right.crossingTime
      || left.previousPosition - right.previousPosition
      || left.driverId.localeCompare(right.driverId)
    ));
    finishCandidates.forEach((candidate, index) => {
      const carIndex = movedCars.findIndex((car) => car.driverId === candidate.driverId);
      const car = movedCars[carIndex];
      if (car?.status !== 'finished') throw new Error(`Finish candidate ${candidate.driverId} is not finished`);
      const finishPosition = alreadyFinished + index + 1;
      movedCars[carIndex] = { ...car, finishPosition, position: finishPosition };
      emit({ type: 'finish', tick: state.tick, driverId: candidate.driverId, position: finishPosition });
    });

    state.cars = getClassification({ cars: movedCars }).map((car, index) => ({
      ...car,
      position: index + 1,
    }));
    updateFlags();
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

    tickFraction(): number {
      return Math.max(0, Math.min(1, pendingTicks));
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
