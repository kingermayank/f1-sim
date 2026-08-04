import type { Weather } from '../domain/race-types';
import type { Prng } from './prng';

export type IncidentKind = 'none' | 'lockup' | 'spin' | 'contact' | 'mechanical';

export interface IncidentInput {
  proximitySeconds: number;
  relativeSpeed: number;
  weather: Weather;
  consistency: number;
  incidentAvoidance: number;
  reliability: number;
  damage: number;
}

export interface IncidentDecision {
  kind: IncidentKind;
  severity: 'minor' | 'major' | null;
  damage: number;
  timeLossSeconds: number;
  retire: boolean;
  safetyCar: boolean;
}

const NO_INCIDENT: IncidentDecision = {
  kind: 'none',
  severity: null,
  damage: 0,
  timeLossSeconds: 0,
  retire: false,
  safetyCar: false,
};

export function evaluateIncident(input: IncidentInput, prng: Prng): IncidentDecision {
  const weatherRisk = input.weather === 'rain' ? 2.2 : input.weather === 'cloudy' ? 1.15 : 1;
  const mechanicalChance = Math.min(0.012, (1 - input.reliability) * 0.004 + input.damage * 0.006);
  if (prng.chance(mechanicalChance)) {
    return {
      kind: 'mechanical',
      severity: 'major',
      damage: 1,
      timeLossSeconds: 0,
      retire: true,
      safetyCar: prng.chance(0.35),
    };
  }

  const proximityRisk = input.proximitySeconds < 0.65
    ? (0.65 - Math.max(0, input.proximitySeconds)) / 0.65
    : 0;
  const driverRisk = (1 - input.consistency) * 0.45 + (1 - input.incidentAvoidance) * 0.55;
  const mistakeChance = Math.min(
    0.018,
    (0.00035 + driverRisk * 0.003 + proximityRisk * Math.abs(input.relativeSpeed) * 0.015) * weatherRisk,
  );
  if (!prng.chance(mistakeChance)) return { ...NO_INCIDENT };

  if (proximityRisk > 0.35 && prng.chance(0.24 + proximityRisk * 0.18)) {
    const major = prng.chance(0.2 + Math.abs(input.relativeSpeed) * 1.5);
    return {
      kind: 'contact',
      severity: major ? 'major' : 'minor',
      damage: major ? 0.5 : 0.12,
      timeLossSeconds: major ? 8 : 2.5,
      retire: major && prng.chance(0.42),
      safetyCar: major && prng.chance(0.72),
    };
  }

  const spin = prng.chance(input.weather === 'rain' ? 0.58 : 0.32);
  const major = spin && prng.chance(0.08 * weatherRisk);
  return {
    kind: spin ? 'spin' : 'lockup',
    severity: major ? 'major' : 'minor',
    damage: major ? 0.28 : spin ? 0.04 : 0.015,
    timeLossSeconds: major ? 10 : spin ? 5 : 1.4,
    retire: false,
    safetyCar: major && prng.chance(0.55),
  };
}

