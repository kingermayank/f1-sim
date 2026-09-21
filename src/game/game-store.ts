import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { DEFAULT_RACE_CONFIG } from '../domain/race-config';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import type { Driver } from '../domain/race-types';
import { createRaceEngine, type RaceEngine } from '../simulation/race-engine';
import type { CarState as AiCarState } from '../simulation/events';
import { SHANGHAI_TRACK } from '../track/shanghai-track';
import { CAR, createCarState, gearFor, stepCar, type CarInput, type CarState } from './car-physics';
import { createProjectedTrack } from './track-projection';

export type GamePhase = 'setup' | 'countdown' | 'racing' | 'finished';
export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * AI pace as a multiple of real Formula 1 pace. The engine fits `laps` into a
 * presentation window, so the window is the dial: equal to `laps × 76.2 s` is
 * real pace; longer is easier. Easy is generous on purpose — a keyboard driver
 * should be able to win their first race with a clean drive.
 */
const AI_PACE: Record<Difficulty, number> = { easy: 0.72, medium: 0.86, hard: 1.0 };
const REFERENCE_LAP_SECONDS = 76.2;
const DRS_GAP_SECONDS = 1.0;
const COUNTDOWN_SECONDS = 3;

export interface LapRecord {
  lap: number;
  seconds: number;
}

export interface GameState {
  phase: GamePhase;
  laps: number;
  difficulty: Difficulty;
  driverId: string;
  seed: string;
  countdown: number;
  elapsed: number;
  car: CarState;
  fraction: number;
  lateral: number;
  onTrack: boolean;
  lap: number;
  /** Best lap and each completed lap, for the result screen. */
  lapTimes: LapRecord[];
  bestLap: number | null;
  currentLapStart: number;
  position: number;
  fieldSize: number;
  gapAheadSeconds: number | null;
  drsAvailable: boolean;
  drsActive: boolean;
  gear: number;
  rpm: number;
  ai: readonly AiCarState[];
  finishPosition: number | null;
}

export interface GameActions {
  configure(options: { driverId: string; laps?: number; difficulty?: Difficulty; seed?: string }): void;
  start(): void;
  step(dt: number, input: CarInput): void;
  resetToTrack(): void;
  restart(): void;
}

export type GameStore = GameState & GameActions;

export const projectedTrack = createProjectedTrack(SHANGHAI_TRACK);

function driverById(id: string): Driver {
  return DRIVERS_2026.find((driver) => driver.id === id) ?? DRIVERS_2026[0];
}

function createEngine(seed: string, laps: number, difficulty: Difficulty, playerId: string): RaceEngine {
  const field = DRIVERS_2026.filter((driver) => driver.id !== playerId);
  const presentationMinutes = (laps * REFERENCE_LAP_SECONDS) / 60 / AI_PACE[difficulty];
  return createRaceEngine(
    { ...DEFAULT_RACE_CONFIG, seed, laps, presentationMinutes, safetyCars: false, incidents: false },
    SHANGHAI_TRACK,
    field,
  );
}

/** Player starts from the back row of the grid, facing along the track. */
function gridStart(): CarState {
  const slot = SHANGHAI_TRACK.gridSlots[SHANGHAI_TRACK.gridSlots.length - 1];
  const { point, tangent } = projectedTrack.at(slot.distance, slot.lateral);
  return createCarState(point.x, point.z, Math.atan2(tangent.z, tangent.x));
}

export function createGameStore() {
  let engine: RaceEngine | null = null;
  // The previous lap fraction, for detecting the line crossing.
  let previousFraction = 0;

  return createStore<GameStore>((set, get) => ({
    phase: 'setup',
    laps: 5,
    difficulty: 'easy',
    driverId: DRIVERS_2026[0].id,
    seed: 'apex-race',
    countdown: COUNTDOWN_SECONDS,
    elapsed: 0,
    car: gridStart(),
    fraction: 0,
    lateral: 0,
    onTrack: true,
    lap: -1,
    lapTimes: [],
    bestLap: null,
    currentLapStart: 0,
    position: DRIVERS_2026.length,
    fieldSize: DRIVERS_2026.length,
    gapAheadSeconds: null,
    drsAvailable: false,
    drsActive: false,
    gear: 1,
    rpm: 0,
    ai: [],
    finishPosition: null,

    configure({ driverId, laps = 5, difficulty = 'easy', seed = `apex-${Date.now().toString(36)}` }) {
      engine = createEngine(seed, laps, difficulty, driverId);
      const car = gridStart();
      previousFraction = projectedTrack.project(car.x, car.z).fraction;
      set({
        phase: 'setup', laps, difficulty, driverId, seed,
        countdown: COUNTDOWN_SECONDS, elapsed: 0, car,
        fraction: previousFraction, lateral: 0, onTrack: true,
        lap: -1, lapTimes: [], bestLap: null, currentLapStart: 0,
        position: DRIVERS_2026.length, fieldSize: DRIVERS_2026.length,
        gapAheadSeconds: null, drsAvailable: false, drsActive: false,
        gear: 1, rpm: 0, ai: engine.snapshot().cars, finishPosition: null,
      });
    },

    start() {
      if (!engine) get().configure({ driverId: get().driverId });
      set({ phase: 'countdown', countdown: COUNTDOWN_SECONDS });
    },

    step(dt, input) {
      const state = get();
      if (!engine) return;

      if (state.phase === 'countdown') {
        const countdown = state.countdown - dt;
        if (countdown <= 0) set({ phase: 'racing', countdown: 0 });
        else set({ countdown });
        return;
      }
      if (state.phase !== 'racing') return;

      // ---- AI -----------------------------------------------------------
      engine.advance(dt);
      const ai = engine.snapshot().cars;

      // ---- player -------------------------------------------------------
      const projection = projectedTrack.project(state.car.x, state.car.z, state.fraction);
      const onTrack = Math.abs(projection.lateral) <= projectedTrack.halfWidth;

      // DRS: in a zone and within a second of the car directly ahead.
      const playerProgress = state.lap + projection.fraction;
      let gapAheadSeconds: number | null = null;
      for (const rival of ai) {
        if (rival.status !== 'running') continue;
        const gap = (rival.lap + rival.distance) - playerProgress;
        if (gap > 0) {
          const seconds = (gap * projectedTrack.lengthMeters) / Math.max(20, state.car.speed);
          if (gapAheadSeconds === null || seconds < gapAheadSeconds) gapAheadSeconds = seconds;
        }
      }
      const drsAvailable = projectedTrack.inPassingZone(projection.fraction)
        && gapAheadSeconds !== null && gapAheadSeconds <= DRS_GAP_SECONDS;

      const car = stepCar(state.car, input, { onTrack, drsAvailable }, dt);
      const drsActive = drsAvailable && input.drs && car.speed > 30;

      // ---- laps -----------------------------------------------------------
      const elapsed = state.elapsed + dt;
      let { lap, lapTimes, bestLap, currentLapStart } = state;
      const crossedForward = previousFraction > 0.85 && projection.fraction < 0.15;
      if (crossedForward) {
        // Lap -1 is the grid; the first crossing starts lap 1 and records nothing.
        if (lap >= 0) {
          const seconds = elapsed - currentLapStart;
          lapTimes = [...lapTimes, { lap: lap + 1, seconds }];
          bestLap = bestLap === null ? seconds : Math.min(bestLap, seconds);
        }
        lap += 1;
        currentLapStart = elapsed;
      }
      previousFraction = projection.fraction;

      // ---- position -------------------------------------------------------
      const finishedAi = ai.filter((rival) => rival.status === 'finished').length;
      const ahead = ai.filter((rival) => rival.status === 'running' && (rival.lap + rival.distance) > playerProgress).length;
      const position = finishedAi + ahead + 1;

      const { gear, rpm } = gearFor(car.speed);

      // Race ends when the player completes the final lap.
      if (lap >= state.laps) {
        set({
          phase: 'finished', car: { ...car, speed: Math.min(car.speed, 30) },
          fraction: projection.fraction, lateral: projection.lateral, onTrack,
          lap, lapTimes, bestLap, currentLapStart, elapsed,
          position, finishPosition: position, gapAheadSeconds, drsAvailable: false, drsActive: false,
          gear, rpm, ai,
        });
        return;
      }

      set({
        car, fraction: projection.fraction, lateral: projection.lateral, onTrack,
        lap, lapTimes, bestLap, currentLapStart, elapsed, position,
        gapAheadSeconds, drsAvailable, drsActive, gear, rpm, ai,
      });
    },

    resetToTrack() {
      // Put the car back on the racing line at its current lap fraction,
      // facing forward, stopped. Costs time; never costs the race.
      const { fraction } = get();
      const { point, tangent } = projectedTrack.at(fraction);
      set({ car: createCarState(point.x, point.z, Math.atan2(tangent.z, tangent.x)), onTrack: true });
    },

    restart() {
      const { driverId, laps, difficulty, seed } = get();
      get().configure({ driverId, laps, difficulty, seed });
      get().start();
    },
  }));
}

export const gameStore = createGameStore();
export const useGameStore = <T,>(selector: (state: GameStore) => T): T => useStore(gameStore, selector);

export function teamOfDriver(driverId: string) {
  const driver = driverById(driverId);
  return TEAMS_2026.find((team) => team.id === driver.teamId) ?? TEAMS_2026[0];
}

export { CAR as CAR_TUNING };
