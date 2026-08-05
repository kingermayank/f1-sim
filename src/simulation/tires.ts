import type { TireCompound } from '../domain/race-types';
import type { TireState } from './events';

interface TireProfile {
  peakGrip: number;
  usefulLife: number;
  cliff: number;
  idealTemperature: number;
  warmupRate: number;
}

export interface TireUpdate extends TireState {
  grip: number;
}

const PROFILES: Record<TireCompound, TireProfile> = {
  soft: { peakGrip: 1.018, usefulLife: 20, cliff: 0.67, idealTemperature: 0.86, warmupRate: 0.24 },
  medium: { peakGrip: 1, usefulLife: 31, cliff: 0.74, idealTemperature: 0.82, warmupRate: 0.18 },
  hard: { peakGrip: 0.988, usefulLife: 46, cliff: 0.82, idealTemperature: 0.78, warmupRate: 0.12 },
  intermediate: { peakGrip: 0.955, usefulLife: 34, cliff: 0.76, idealTemperature: 0.7, warmupRate: 0.2 },
  wet: { peakGrip: 0.92, usefulLife: 42, cliff: 0.82, idealTemperature: 0.62, warmupRate: 0.16 },
};

const clamp = (value: number, minimum: number, maximum: number) => (
  Math.min(maximum, Math.max(minimum, value))
);

/** Advances tire state by a distance measured in laps without mutating it. */
export function updateTire(
  tire: Readonly<TireState>,
  distanceLaps: number,
  trackTemperature: number,
): TireUpdate {
  if (!Number.isFinite(distanceLaps) || distanceLaps < 0) {
    throw new RangeError('Tire distance must be finite and non-negative');
  }

  const profile = PROFILES[tire.compound];
  const thermalTarget = clamp(
    profile.idealTemperature + (trackTemperature - 0.75) * 0.22,
    0.45,
    1,
  );
  const thermalStep = 1 - Math.exp(-profile.warmupRate * distanceLaps);
  const temperature = clamp(
    tire.temperature + (thermalTarget - tire.temperature) * thermalStep,
    0,
    1.2,
  );
  const wear = clamp(tire.wear + distanceLaps / profile.usefulLife, 0, 1);
  const temperaturePenalty = Math.min(0.12, Math.abs(temperature - profile.idealTemperature) * 0.18);
  const ordinaryWearPenalty = wear * 0.035;
  const cliffProgress = Math.max(0, (wear - profile.cliff) / (1 - profile.cliff));
  const cliffPenalty = cliffProgress * cliffProgress * 0.2;

  return {
    compound: tire.compound,
    wear,
    temperature,
    grip: clamp(profile.peakGrip - temperaturePenalty - ordinaryWearPenalty - cliffPenalty, 0.68, 1.03),
  };
}
