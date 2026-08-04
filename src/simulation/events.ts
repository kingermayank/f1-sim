import type { TireCompound, Weather } from '../domain/race-types';

export interface TireState {
  compound: TireCompound;
  wear: number;
  temperature: number;
}

export interface CarTiming {
  lastLap: number | null;
  bestLap: number | null;
  totalTime: number;
}

export type PitState = 'track' | 'entry' | 'lane' | 'exit' | 'stopped';
export type CarStatus = 'running' | 'finished' | 'retired';
export type TargetLine = 'racing' | 'attack' | 'defend' | 'pit';

export interface CarState {
  driverId: string;
  lap: number;
  /** Normalized distance around the current lap, from 0 (line) to < 1. */
  distance: number;
  lateralOffset: number;
  speed: number;
  tire: TireState;
  fuelFactor: number;
  damage: number;
  pitState: PitState;
  position: number;
  timing: CarTiming;
  status: CarStatus;
  targetLine: TargetLine;
  finishPosition?: number;
  retirementTick?: number;
}

export type RacePhase = 'grid' | 'racing' | 'finished';
export type RaceFlag = 'green' | 'yellow' | 'safety-car';
export type SafetyCarState = 'none' | 'deploying' | 'deployed' | 'returning';

export interface RaceState {
  seed: string;
  tick: number;
  elapsedSeconds: number;
  phase: RacePhase;
  flag: RaceFlag;
  weather: Weather;
  safetyCar: SafetyCarState;
  cars: CarState[];
  events: RaceEvent[];
}

export type RaceEvent =
  | { type: 'start'; tick: number }
  | { type: 'lap'; tick: number; driverId: string; lap: number; lapTime: number }
  | { type: 'overtake'; tick: number; attackerId: string; defenderId: string; position: number }
  | { type: 'pit-entry' | 'pit-exit'; tick: number; driverId: string }
  | { type: 'tire-change'; tick: number; driverId: string; compound: TireCompound }
  | { type: 'incident'; tick: number; driverIds: string[]; severity: 'minor' | 'major' }
  | { type: 'retirement'; tick: number; driverId: string; reason: string }
  | { type: 'flag'; tick: number; flag: RaceFlag }
  | { type: 'weather'; tick: number; weather: Weather }
  | { type: 'finish'; tick: number; driverId: string; position: number };
