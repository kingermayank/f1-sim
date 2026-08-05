import type { Driver, TireCompound, Weather } from '../domain/race-types';
import type { Prng } from './prng';

export interface StrategyStop {
  window: readonly [number, number];
  targetLap: number;
  compound: TireCompound;
}

export interface RaceStrategy {
  initialCompound: TireCompound;
  stopCount: 1 | 2;
  stops: readonly StrategyStop[];
}

export interface StrategySituation {
  lap: number;
  safetyCar: boolean;
  trafficSeconds: number;
  tireWear: number;
  tireGrip: number;
  damage: number;
}

function windowAround(target: number, radius: number): readonly [number, number] {
  return [Math.max(2, target - radius), Math.min(77, target + radius)] as const;
}

export function createStrategy(driver: Driver, weather: Weather, prng: Prng): RaceStrategy {
  if (weather === 'rain') {
    const targetLap = Math.round(prng.range(27, 39));
    return {
      initialCompound: 'intermediate',
      stopCount: 1,
      stops: [{ window: windowAround(targetLap, 5), targetLap, compound: 'wet' }],
    };
  }

  const twoStopChance = 0.2 + (1 - driver.ratings.tireManagement) * 0.45;
  if (prng.chance(twoStopChance)) {
    const firstLap = Math.round(prng.range(19, 25));
    const secondLap = Math.round(prng.range(49, 59));
    return {
      initialCompound: 'medium',
      stopCount: 2,
      stops: [
        { window: windowAround(firstLap, 4), targetLap: firstLap, compound: 'hard' },
        { window: windowAround(secondLap, 5), targetLap: secondLap, compound: 'soft' },
      ],
    };
  }

  const targetLap = Math.round(prng.range(31, 42) + (driver.ratings.tireManagement - 0.8) * 8);
  return {
    initialCompound: 'medium',
    stopCount: 1,
    stops: [{ window: windowAround(targetLap, 5), targetLap, compound: 'hard' }],
  };
}

/** Returns a bounded adaptive pit decision for the next planned stop. */
export function shouldPit(stop: StrategyStop, situation: StrategySituation): boolean {
  const [earliest, latest] = stop.window;
  if (situation.lap >= latest) return true;
  const adaptiveWindowOpen = situation.lap >= Math.max(2, earliest - 6);
  if (
    adaptiveWindowOpen
    && (situation.tireWear >= 0.78 || situation.tireGrip <= 0.87 || situation.damage >= 0.15)
  ) return true;
  if (situation.lap < earliest) {
    return situation.safetyCar && situation.lap >= Math.max(2, earliest - 3);
  }
  if (situation.safetyCar) return true;
  if (situation.trafficSeconds < 0.7 && situation.lap < stop.targetLap + 2) return false;
  return situation.lap >= stop.targetLap;
}
