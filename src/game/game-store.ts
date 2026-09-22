import { useEffect, useRef, useState } from 'react';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { DEFAULT_RACE_CONFIG } from '../domain/race-config';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import type { Driver } from '../domain/race-types';
import { TICK_SECONDS, createRaceEngine, type RaceEngine } from '../simulation/race-engine';
import type { CarState as AiCarState } from '../simulation/events';
import { SHANGHAI_TRACK } from '../track/shanghai-track';
import { CAR, createCarState, gearFor, stepCar, type CarInput, type CarState, type Surface } from './car-physics';
import { avoidanceTarget, resolveCarContact, spaceField, type Pose } from './field';
import { constrainToWalls, createProjectedTrack } from './track-projection';

/**
 * The race as a journey: an intro flyover of the grid, the five-light start,
 * the race, and the chequered flag with a full classification.
 *
 * - `setup`: configured, nothing moving.
 * - `intro`: cinematic over the grid; Enter skips it.
 * - `lights`: cars held on the grid while the gantry lights up. Throttle
 *   revs the engine; the car launches at lights out, and the reaction time
 *   from lights out to the first throttle is measured.
 * - `racing`: the race. Ends when the player completes the final lap.
 * - `finished`: cool-down; the classification is fixed at the moment of the
 *   player's finish.
 */
export type GamePhase = 'setup' | 'intro' | 'lights' | 'racing' | 'finished';
export type Difficulty = 'easy' | 'medium' | 'hard';
/** How many cars line up including the player: the full field, or fewer for slower machines. */
export type FieldSize = 14 | 10 | 6;

/**
 * AI pace as a multiple of real Formula 1 pace. The engine fits `laps` into a
 * presentation window, so the window is the dial: equal to `laps × 76.2 s` is
 * real pace; longer is easier. Easy is generous on purpose — a keyboard driver
 * should be able to win their first race with a clean drive.
 */
const AI_PACE: Record<Difficulty, number> = { easy: 0.72, medium: 0.86, hard: 1.0 };
const REFERENCE_LAP_SECONDS = 76.2;
const DRS_GAP_SECONDS = 1.0;
/** Rivals within this many metres of the player (either way) move off the racing line. */
const AVOIDANCE_RANGE_METRES = 40;
const AVOIDANCE_OFFSET_METRES = 3.6;
const AVOIDANCE_RATE = 3;
/** Grid row pitch, matching the engine's own grid. */
const GRID_ROW_METRES = 9.5;
export const INTRO_SECONDS = 11;
/** One light per second, then a hold of unpredictable length before they go out. */
const LIGHT_INTERVAL_SECONDS = 1;
const LIGHTS_HOLD_MIN_SECONDS = 0.4;
const LIGHTS_HOLD_MAX_SECONDS = 1.6;
/** DRS is enabled from the second lap, as in the real thing. */
const DRS_FROM_LAP = 1;
/** A reaction this quick gets called out. */
const SHARP_REACTION_SECONDS = 0.3;
/** How many toasts the HUD keeps; older ones fall off. */
const EVENT_LIMIT = 6;
/** Rough average AI speed for projecting the gap of a car still running at the flag. */
const PROJECTED_AI_SPEED_MPS = 52;
/**
 * The engine has no launch: at lights out its cars are at race speed within
 * a tick, which on the grid looks like teleporting away. Engine time is
 * ramped over these seconds so the field accelerates off the line.
 */
const AI_LAUNCH_SECONDS = 4.5;

export interface LapRecord {
  lap: number;
  seconds: number;
}

export type GameEventKind = 'pass' | 'passed' | 'lap' | 'best' | 'drs' | 'limits' | 'contact' | 'launch' | 'final' | 'flag';

export interface GameEvent {
  id: number;
  /** Race-clock time the event happened. */
  at: number;
  kind: GameEventKind;
  text: string;
}

export interface ClassificationRow {
  driverId: string;
  position: number;
  /** Player's row. */
  isPlayer: boolean;
  /** Race time in seconds for finishers; projected for cars still running at the flag. */
  raceTime: number;
  /** Seconds behind the winner. */
  gap: number;
  bestLap: number | null;
  penaltySeconds: number;
  /** Set on the row with the fastest lap of the race. */
  fastestLap: boolean;
  /** Laps completed by cars that did not reach the flag before the player. */
  lapsDown: number;
}

export interface GameState {
  phase: GamePhase;
  laps: number;
  difficulty: Difficulty;
  driverId: string;
  seed: string;
  /** Assets loaded and shaders compiled: the intro clock waits for this. */
  ready: boolean;
  /** Seconds into the intro cinematic. */
  introSeconds: number;
  /** Lights lit on the gantry, 0-5. */
  lights: number;
  /** Seconds since the last light change. */
  lightsSeconds: number;
  /** True once the lights go out; the HUD flashes it briefly. */
  lightsOut: boolean;
  /** Seconds from lights out to the first throttle; null until measured. */
  reactionSeconds: number | null;
  /** Race clock: 0 at lights out. */
  elapsed: number;
  car: CarState;
  fraction: number;
  lateral: number;
  /** What the tyres are on. Kerbs are fine; `onTrack` is false only on grass. */
  surface: Surface;
  onTrack: boolean;
  /** Incremented whenever the car is placed rather than driven, so the camera snaps. */
  placement: number;
  paused: boolean;
  lap: number;
  /** Best lap and each completed lap, for the result screen. */
  lapTimes: LapRecord[];
  bestLap: number | null;
  currentLapStart: number;
  position: number;
  fieldSize: number;
  gapAheadSeconds: number | null;
  gapBehindSeconds: number | null;
  drsAvailable: boolean;
  drsActive: boolean;
  /** True on the frame the car touched a barrier, for audio and HUD. */
  hitWall: boolean;
  /** Impact strength in [0, 1] on the frame the car touched a rival, else 0. */
  hitCar: number;
  /** Track surface height directly under the car. The renderer uses this, never terrain. */
  surfaceY: number;
  /** Body roll (lean into corners) and pitch (dive/squat), radians, for the renderer. */
  bodyRoll: number;
  bodyPitch: number;
  gear: number;
  rpm: number;
  ai: readonly AiCarState[];
  events: GameEvent[];
  /** The player is on their last lap: the marshal waves the flag at the line. */
  finalLap: boolean;
  finishPosition: number | null;
  /** Player's race time at the flag, including penalties. */
  raceTime: number | null;
  classification: ClassificationRow[];
}

export interface GameActions {
  configure(options: { driverId: string; laps?: number; difficulty?: Difficulty; fieldSize?: FieldSize; seed?: string }): void;
  /** Begin the journey: the intro, then the lights. */
  start(): void;
  setReady(ready: boolean): void;
  skipIntro(): void;
  step(dt: number, input: CarInput): void;
  resetToTrack(): void;
  togglePause(): void;
  /** A fresh race with the same car and settings but a new seed, so the field races differently. */
  restart(): void;
}

export type GameStore = GameState & GameActions;

export const projectedTrack = createProjectedTrack(SHANGHAI_TRACK);

function driverById(id: string): Driver {
  return DRIVERS_2026.find((driver) => driver.id === id) ?? DRIVERS_2026[0];
}

export function driverName(id: string): string {
  return driverById(id).name;
}

function createEngine(seed: string, laps: number, difficulty: Difficulty, playerId: string, fieldSize: FieldSize): RaceEngine {
  // Trim from the back of the grid order so the front-runners are always there.
  const field = DRIVERS_2026.filter((driver) => driver.id !== playerId).slice(0, fieldSize - 1);
  const presentationMinutes = (laps * REFERENCE_LAP_SECONDS) / 60 / AI_PACE[difficulty];
  return createRaceEngine(
    { ...DEFAULT_RACE_CONFIG, seed, laps, presentationMinutes, safetyCars: false, incidents: false },
    SHANGHAI_TRACK,
    field,
  );
}

/** Small deterministic hash of the seed, for the lights hold. */
function seedFraction(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

/**
 * Player starts one row behind the last AI car, on the other side of the
 * track from it, facing along the track. Placed from the engine's actual grid
 * rather than the track's slot table so the two can never overlap.
 */
function gridStart(field: readonly AiCarState[]): CarState {
  const last = field.reduce<AiCarState | null>((best, car) => (
    best === null || car.lap + car.distance < best.lap + best.distance ? car : best
  ), null);
  const slot = SHANGHAI_TRACK.gridSlots[SHANGHAI_TRACK.gridSlots.length - 1];
  const distance = last ? last.distance - GRID_ROW_METRES / projectedTrack.lengthMeters : slot.distance;
  const lateral = last ? -Math.sign(last.lateralOffset || 1) * Math.abs(slot.lateral) : slot.lateral;
  const { point, tangent } = projectedTrack.at(distance, lateral);
  return createCarState(point.x, point.z, Math.atan2(tangent.z, tangent.x));
}

function progressOf(car: AiCarState): number {
  return car.lap + car.distance;
}

function surfaceAt(lateral: number): Surface {
  const distance = Math.abs(lateral);
  if (distance <= projectedTrack.halfWidth) return 'tarmac';
  if (distance <= projectedTrack.kerbHalfWidth) return 'kerb';
  return 'grass';
}

export function createGameStore() {
  let engine: RaceEngine | null = null;
  // The previous lap fraction, for detecting the line crossing.
  let previousFraction = 0;
  // Smoothed lateral offset per rival, so moving aside reads as a decision,
  // and the side each rival chose, so it never changes its mind mid-move and
  // crosses the player's nose.
  const aiLateral = new Map<string, number>();
  const aiSide = new Map<string, number>();
  // Race clock at which each AI car took the flag.
  const aiFinishTimes = new Map<string, number>();
  let lightsHold = 1;
  // Whether the car was leaning on a barrier last step: first contact costs
  // speed, sliding along it does not.
  let touchingWall = false;
  let nextEventId = 1;
  // So the track-limits warning fires once per excursion.
  let wasOnTrack = true;
  let wasDrsActive = false;

  function pushEvent(events: GameEvent[], at: number, kind: GameEventKind, text: string): GameEvent[] {
    const next = [...events, { id: nextEventId, at, kind, text }];
    nextEventId += 1;
    return next.length > EVENT_LIMIT ? next.slice(next.length - EVENT_LIMIT) : next;
  }

  function stepField(dt: number, playerProgress: number, playerLateral: number, raceSeconds = Number.POSITIVE_INFINITY): AiCarState[] {
    if (!engine) return [];
    // Launch ramp: engine time runs slow for the first seconds after lights out.
    const launch = Math.min(1, Math.max(0.08, raceSeconds / AI_LAUNCH_SECONDS));
    engine.advance(dt * launch);
    // The engine moves in tenth-of-a-second ticks. Between ticks, carry each
    // running car forward along its own speed so it moves every frame.
    const between = engine.tickFraction() * TICK_SECONDS;
    const smoothed = engine.snapshot().cars.map((rival) => {
      if (rival.status !== 'running' || rival.pitState !== 'track' || between <= 0) return rival;
      const progress = progressOf(rival) + rival.speed * between;
      const lap = Math.floor(progress);
      return { ...rival, lap, distance: progress - lap };
    });
    const ease = 1 - Math.exp(-dt * AVOIDANCE_RATE);
    return spaceField(smoothed, projectedTrack.lengthMeters).map((rival) => {
      let target = 0;
      if (rival.status === 'running' && rival.pitState === 'track') {
        const inRange = Math.abs(progressOf(rival) - playerProgress) * projectedTrack.lengthMeters <= AVOIDANCE_RANGE_METRES;
        if (!inRange) aiSide.delete(rival.driverId);
        else if (!aiSide.has(rival.driverId)) aiSide.set(rival.driverId, playerLateral >= 0 ? 1 : -1);
        const side = aiSide.get(rival.driverId) ?? 1;
        target = avoidanceTarget(progressOf(rival), playerProgress, side, {
          rangeLaps: AVOIDANCE_RANGE_METRES / projectedTrack.lengthMeters,
          offsetMetres: AVOIDANCE_OFFSET_METRES,
          halfWidth: projectedTrack.halfWidth,
        });
      }
      const current = aiLateral.get(rival.driverId) ?? 0;
      const avoidance = current + (target - current) * ease;
      aiLateral.set(rival.driverId, avoidance);
      return { ...rival, lateralOffset: rival.lateralOffset + avoidance };
    });
  }

  function classify(state: GameState, ai: readonly AiCarState[], playerRaceTime: number, penalty: number): ClassificationRow[] {
    const playerProgress = state.laps;
    const rows: Omit<ClassificationRow, 'position' | 'gap' | 'fastestLap'>[] = [];
    rows.push({
      driverId: state.driverId, isPlayer: true, raceTime: playerRaceTime + penalty,
      bestLap: state.bestLap, penaltySeconds: penalty, lapsDown: 0,
    });
    for (const rival of ai) {
      const finished = aiFinishTimes.get(rival.driverId);
      // Engine lap times are in engine seconds; the race clock runs at AI pace.
      const bestLap = rival.timing.bestLap === null ? null : rival.timing.bestLap / AI_PACE[state.difficulty];
      if (finished !== undefined) {
        rows.push({ driverId: rival.driverId, isPlayer: false, raceTime: finished, bestLap, penaltySeconds: 0, lapsDown: 0 });
        continue;
      }
      // Still running when the flag fell: project the time to the line from
      // how far back it is, and note whole laps down.
      const behind = Math.max(0, playerProgress - progressOf(rival));
      const lapsDown = Math.floor(behind);
      rows.push({
        driverId: rival.driverId, isPlayer: false,
        raceTime: playerRaceTime + (behind * projectedTrack.lengthMeters) / PROJECTED_AI_SPEED_MPS,
        bestLap, penaltySeconds: 0, lapsDown,
      });
    }
    rows.sort((a, b) => a.lapsDown - b.lapsDown || a.raceTime - b.raceTime);
    const winner = rows[0].raceTime;
    const fastest = rows.reduce<number | null>((best, row) => (
      row.bestLap !== null && (best === null || row.bestLap < best) ? row.bestLap : best
    ), null);
    return rows.map((row, index) => ({
      ...row, position: index + 1, gap: row.raceTime - winner,
      fastestLap: fastest !== null && row.bestLap === fastest,
    }));
  }

  return createStore<GameStore>((set, get) => ({
    phase: 'setup',
    laps: 5,
    difficulty: 'easy',
    driverId: DRIVERS_2026[0].id,
    seed: 'apex-race',
    ready: false,
    introSeconds: 0,
    lights: 0,
    lightsSeconds: 0,
    lightsOut: false,
    reactionSeconds: null,
    elapsed: 0,
    car: gridStart([]),
    fraction: 0,
    lateral: 0,
    surface: 'tarmac',
    onTrack: true,
    placement: 0,
    paused: false,
    lap: -1,
    lapTimes: [],
    bestLap: null,
    currentLapStart: 0,
    position: DRIVERS_2026.length,
    fieldSize: DRIVERS_2026.length,
    gapAheadSeconds: null,
    gapBehindSeconds: null,
    drsAvailable: false,
    drsActive: false,
    hitWall: false,
    hitCar: 0,
    surfaceY: 0,
    bodyRoll: 0,
    bodyPitch: 0,
    gear: 1,
    rpm: 0,
    ai: [],
    events: [],
    finalLap: false,
    finishPosition: null,
    raceTime: null,
    classification: [],

    configure({ driverId, laps = 5, difficulty = 'easy', fieldSize = 14, seed = `apex-${Date.now().toString(36)}` }) {
      engine = createEngine(seed, laps, difficulty, driverId, fieldSize);
      aiLateral.clear();
      aiSide.clear();
      aiFinishTimes.clear();
      wasOnTrack = true;
      touchingWall = false;
      wasDrsActive = false;
      lightsHold = LIGHTS_HOLD_MIN_SECONDS + seedFraction(seed) * (LIGHTS_HOLD_MAX_SECONDS - LIGHTS_HOLD_MIN_SECONDS);
      const car = gridStart(engine.snapshot().cars);
      previousFraction = projectedTrack.project(car.x, car.z).fraction;
      set({
        phase: 'setup', laps, difficulty, driverId, seed,
        ready: false, introSeconds: 0, lights: 0, lightsSeconds: 0, lightsOut: false, reactionSeconds: null,
        elapsed: 0, car,
        fraction: previousFraction, lateral: 0, surface: 'tarmac', onTrack: true, placement: get().placement + 1, paused: false,
        lap: -1, lapTimes: [], bestLap: null, currentLapStart: 0,
        position: fieldSize, fieldSize,
        gapAheadSeconds: null, gapBehindSeconds: null, drsAvailable: false, drsActive: false, hitWall: false, hitCar: 0,
        surfaceY: projectedTrack.project(car.x, car.z).point.y, bodyRoll: 0, bodyPitch: 0,
        gear: 1, rpm: 0, ai: spaceField(engine.snapshot().cars, projectedTrack.lengthMeters),
        events: [], finalLap: false, finishPosition: null, raceTime: null, classification: [],
      });
    },

    start() {
      if (!engine) get().configure({ driverId: get().driverId });
      set({ phase: 'intro', introSeconds: 0 });
    },

    setReady(ready) {
      set({ ready });
    },

    skipIntro() {
      if (get().phase === 'intro') set({ phase: 'lights', lights: 0, lightsSeconds: 0, lightsOut: false });
    },

    step(dt, input) {
      const state = get();
      if (!engine || state.paused) return;

      if (state.phase === 'intro') {
        const introSeconds = state.introSeconds + dt;
        if (introSeconds >= INTRO_SECONDS) set({ phase: 'lights', introSeconds, lights: 0, lightsSeconds: 0, lightsOut: false });
        else set({ introSeconds });
        return;
      }

      if (state.phase === 'lights') {
        // Held on the grid: the throttle only revs the engine.
        const revving = input.throttle > 0 ? 0.55 + input.throttle * 0.4 : 0.12;
        let { lights, lightsSeconds } = state;
        lightsSeconds += dt;
        if (lights < 5 && lightsSeconds >= LIGHT_INTERVAL_SECONDS) {
          lights += 1;
          lightsSeconds = 0;
        } else if (lights === 5 && lightsSeconds >= lightsHold) {
          // Lights out. The race clock starts here; a throttle already held launches now.
          set({ phase: 'racing', lights: 0, lightsSeconds: 0, lightsOut: true, rpm: revving, elapsed: 0, currentLapStart: 0 });
          previousFraction = state.fraction;
          return;
        }
        set({ lights, lightsSeconds, rpm: revving });
        return;
      }

      if (state.phase === 'finished') {
        // Cool-down: the field keeps running and the player coasts to a stop.
        const ai = stepField(dt, state.laps, state.lateral);
        const projection = projectedTrack.project(state.car.x, state.car.z, state.fraction);
        const stepped = stepCar(state.car, { throttle: 0, brake: 0.25, steer: input.steer, drs: false }, { onTrack: state.onTrack, surface: state.surface, drsAvailable: false }, dt);
        const after = projectedTrack.project(stepped.x, stepped.z, projection.fraction);
        const walled = constrainToWalls(stepped, after, projectedTrack.wallHalfWidth, touchingWall);
        touchingWall = walled.hitWall;
        const car = { ...stepped, x: walled.x, z: walled.z, heading: walled.heading, speed: walled.speed };
        const { gear, rpm } = gearFor(car.speed);
        set({ ai, car, fraction: after.fraction, lateral: after.lateral, surfaceY: after.point.y, gear, rpm, hitWall: false, hitCar: 0, drsActive: false, drsAvailable: false });
        return;
      }

      if (state.phase !== 'racing') return;

      // ---- AI -----------------------------------------------------------
      const projection = projectedTrack.project(state.car.x, state.car.z, state.fraction);
      const surface = surfaceAt(projection.lateral);
      const onTrack = surface !== 'grass';
      const playerProgress = state.lap + projection.fraction;
      const ai = stepField(dt, playerProgress, projection.lateral, state.elapsed);
      const elapsed = state.elapsed + dt;
      for (const rival of ai) {
        if (rival.status === 'finished' && !aiFinishTimes.has(rival.driverId)) aiFinishTimes.set(rival.driverId, elapsed);
      }

      // ---- player -------------------------------------------------------
      // DRS: in a zone and within a second of the car directly ahead.
      let gapAheadSeconds: number | null = null;
      let gapBehindSeconds: number | null = null;
      for (const rival of ai) {
        if (rival.status !== 'running') continue;
        const gap = progressOf(rival) - playerProgress;
        const seconds = (Math.abs(gap) * projectedTrack.lengthMeters) / Math.max(20, state.car.speed);
        if (gap > 0) {
          if (gapAheadSeconds === null || seconds < gapAheadSeconds) gapAheadSeconds = seconds;
        } else if (gapBehindSeconds === null || seconds < gapBehindSeconds) gapBehindSeconds = seconds;
      }
      const drsAvailable = state.lap >= DRS_FROM_LAP && projectedTrack.inPassingZone(projection.fraction)
        && gapAheadSeconds !== null && gapAheadSeconds <= DRS_GAP_SECONDS;

      const stepped = stepCar(state.car, input, { onTrack, surface, drsAvailable }, dt);
      // Re-project after moving and hold the car inside the barriers, so it can
      // never wander out over terrain the circuit model never meant to be driven.
      const after = projectedTrack.project(stepped.x, stepped.z, projection.fraction);
      const walled = constrainToWalls(stepped, after, projectedTrack.wallHalfWidth, touchingWall);
      touchingWall = walled.hitWall;

      // Contact with rivals close enough to matter. Only nearby cars are tested.
      const nearby: Pose[] = [];
      for (const rival of ai) {
        if (rival.status !== 'running' || rival.pitState !== 'track') continue;
        if (Math.abs(progressOf(rival) - playerProgress) * projectedTrack.lengthMeters > 30) continue;
        const { point, tangent } = projectedTrack.at(rival.distance, rival.lateralOffset);
        // Engine speed is laps per engine second; the race clock runs at AI pace.
        const speedMps = rival.speed * projectedTrack.lengthMeters * AI_PACE[state.difficulty];
        nearby.push({ x: point.x, z: point.z, heading: Math.atan2(tangent.z, tangent.x), speed: speedMps });
      }
      const touched = resolveCarContact(walled, nearby);
      const car = { ...stepped, x: touched.x, z: touched.z, heading: touched.heading, speed: touched.speed };
      const drsActive = drsAvailable && input.drs && car.speed > 30;

      // ---- events -------------------------------------------------------
      let events = state.events;
      let { reactionSeconds } = state;
      if (reactionSeconds === null && input.throttle > 0) {
        reactionSeconds = state.elapsed;
        events = pushEvent(events, elapsed, 'launch', `Reaction ${reactionSeconds.toFixed(2)}s${reactionSeconds <= SHARP_REACTION_SECONDS ? ' · sharp' : ''}`);
      }
      if (drsActive && !wasDrsActive) events = pushEvent(events, elapsed, 'drs', 'DRS open');
      wasDrsActive = drsActive;
      if (!onTrack && wasOnTrack && car.speed > 15) events = pushEvent(events, elapsed, 'limits', 'Track limits · slow on the grass');
      const hitWall = walled.hitWall;
      const hitCar = touched.contact;
      wasOnTrack = onTrack;
      if (hitCar > 0.35 && state.hitCar <= 0.35) events = pushEvent(events, elapsed, 'contact', 'Contact');

      // ---- laps -----------------------------------------------------------
      let { lap, lapTimes, bestLap, currentLapStart } = state;
      const settled = projectedTrack.project(car.x, car.z, after.fraction);
      const crossedForward = previousFraction > 0.85 && settled.fraction < 0.15
        && Math.abs(settled.lateral) <= projectedTrack.wallHalfWidth;
      if (crossedForward) {
        // Lap -1 is the grid; the first crossing starts lap 1 and records nothing.
        if (lap >= 0) {
          const seconds = elapsed - currentLapStart;
          lapTimes = [...lapTimes, { lap: lap + 1, seconds }];
          const isBest = bestLap === null || seconds < bestLap;
          bestLap = isBest ? seconds : bestLap;
          events = pushEvent(events, elapsed, isBest ? 'best' : 'lap', `Lap ${lap + 1} · ${formatLapTime(seconds)}${isBest && lapTimes.length > 1 ? ' · personal best' : ''}`);
        }
        lap += 1;
        currentLapStart = elapsed;
        if (lap === DRS_FROM_LAP && state.laps > DRS_FROM_LAP + 1) events = pushEvent(events, elapsed, 'drs', 'DRS enabled');
        if (lap === state.laps - 1) events = pushEvent(events, elapsed, 'final', 'Final lap');
      }
      previousFraction = settled.fraction;
      const finalLap = lap === state.laps - 1;

      // ---- position -------------------------------------------------------
      const finishedAi = ai.filter((rival) => rival.status === 'finished').length;
      const ahead = ai.filter((rival) => rival.status === 'running' && progressOf(rival) > playerProgress).length;
      const position = finishedAi + ahead + 1;
      if (position < state.position && state.lap >= 0) {
        // Who did we just get past? The closest running rival now behind us.
        const passed = ai
          .filter((rival) => rival.status === 'running' && progressOf(rival) <= playerProgress)
          .sort((a, b) => progressOf(b) - progressOf(a))[0];
        if (passed) events = pushEvent(events, elapsed, 'pass', `P${position} · passed ${driverName(passed.driverId)}`);
      } else if (position > state.position && state.lap >= 0) {
        const passer = ai
          .filter((rival) => rival.status === 'running' && progressOf(rival) > playerProgress)
          .sort((a, b) => progressOf(a) - progressOf(b))[0];
        if (passer) events = pushEvent(events, elapsed, 'passed', `P${position} · passed by ${driverName(passer.driverId)}`);
      }

      const { gear, rpm } = gearFor(car.speed);

      // Weight transfer, damped: lean into corners, dive under braking, squat on
      // throttle. Small angles do more for the feel of mass than any geometry.
      let dHeading = car.heading - state.car.heading;
      while (dHeading > Math.PI) dHeading -= Math.PI * 2;
      while (dHeading < -Math.PI) dHeading += Math.PI * 2;
      const yawRate = dHeading / dt;
      const accel = (car.speed - state.car.speed) / dt;
      const targetRoll = Math.max(-0.09, Math.min(0.09, -yawRate * car.speed * 0.0016));
      const targetPitch = Math.max(-0.06, Math.min(0.06, -accel * 0.004));
      const bodyEase = 1 - Math.exp(-dt * 8);
      const bodyRoll = state.bodyRoll + (targetRoll - state.bodyRoll) * bodyEase;
      const bodyPitch = state.bodyPitch + (targetPitch - state.bodyPitch) * bodyEase;
      const surfaceY = settled.point.y;

      // Race ends when the player completes the final lap.
      if (lap >= state.laps) {
        const penalty = 0;
        const finalState: GameState = { ...state, bestLap, lapTimes };
        const classification = classify(finalState, ai, elapsed, penalty);
        const finishPosition = classification.find((row) => row.isPlayer)?.position ?? position;
        set({
          phase: 'finished', car,
          fraction: settled.fraction, lateral: settled.lateral, surface, onTrack, hitWall, hitCar, surfaceY, bodyRoll, bodyPitch,
          lap, lapTimes, bestLap, currentLapStart, elapsed,
          position: finishPosition, finishPosition, raceTime: elapsed + penalty, classification,
          gapAheadSeconds, gapBehindSeconds, drsAvailable: false, drsActive: false,
          gear, rpm, ai, finalLap: false, reactionSeconds,
          events: pushEvent(events, elapsed, 'flag', `Chequered flag · P${finishPosition}`),
        });
        return;
      }

      set({
        car, fraction: settled.fraction, lateral: settled.lateral, surface, onTrack, hitWall, hitCar, surfaceY, bodyRoll, bodyPitch,
        lap, lapTimes, bestLap, currentLapStart, elapsed, position,
        gapAheadSeconds, gapBehindSeconds, drsAvailable, drsActive, gear, rpm, ai, events, finalLap, reactionSeconds,
      });
    },

    resetToTrack() {
      // Put the car back on the racing line at its current lap fraction,
      // facing forward, stopped. Costs time; never costs the race.
      const { fraction, placement } = get();
      const { point, tangent } = projectedTrack.at(fraction);
      touchingWall = false;
      set({
        car: createCarState(point.x, point.z, Math.atan2(tangent.z, tangent.x)),
        lateral: 0, surface: 'tarmac', onTrack: true, surfaceY: point.y, bodyRoll: 0, bodyPitch: 0, placement: placement + 1,
      });
    },

    togglePause() {
      const { phase, paused } = get();
      if (phase === 'racing' || phase === 'lights') set({ paused: !paused });
    },

    restart() {
      const { driverId, laps, difficulty, fieldSize } = get();
      get().configure({ driverId, laps, difficulty, fieldSize: fieldSize as FieldSize });
      get().start();
    },
  }));
}

export function formatLapTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function formatGap(seconds: number): string {
  return `+${seconds.toFixed(3)}s`;
}

export const gameStore = createGameStore();
export const useGameStore = <T,>(selector: (state: GameStore) => T): T => useStore(gameStore, selector);

/**
 * A store selector sampled at a fixed rate instead of on every physics step.
 * The store updates up to 120 times a second; a React re-render of the HUD
 * on each one is measurable CPU time for numbers nobody can read that fast.
 */
export function useGameStoreSampled<T>(selector: (state: GameStore) => T, hz = 30): T {
  const [value, setValue] = useState(() => selector(gameStore.getState()));
  const latest = useRef(selector);
  latest.current = selector;
  useEffect(() => {
    const interval = window.setInterval(() => {
      const next = latest.current(gameStore.getState());
      setValue((previous) => (Object.is(previous, next) ? previous : next));
    }, 1000 / hz);
    return () => window.clearInterval(interval);
  }, [hz]);
  return value;
}

export function teamOfDriver(driverId: string) {
  const driver = driverById(driverId);
  return TEAMS_2026.find((team) => team.id === driver.teamId) ?? TEAMS_2026[0];
}

export { CAR as CAR_TUNING };
