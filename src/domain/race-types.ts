import { z } from 'zod';

export type TeamId =
  | 'mercedes' | 'ferrari' | 'mclaren' | 'red-bull' | 'racing-bulls'
  | 'alpine' | 'haas' | 'audi' | 'williams' | 'aston-martin' | 'cadillac';

export type TireCompound = 'soft' | 'medium' | 'hard' | 'intermediate' | 'wet';
export type Weather = 'sunny' | 'cloudy' | 'rain';

export interface Ratings {
  pace: number;
  qualifying: number;
  consistency: number;
  overtaking: number;
  defending: number;
  tireManagement: number;
  wetSkill: number;
  reliability: number;
  incidentAvoidance: number;
  pitExecution: number;
}

const rating = z.number().min(0).max(1);

export const ratingsSchema = z.object({
  pace: rating,
  qualifying: rating,
  consistency: rating,
  overtaking: rating,
  defending: rating,
  tireManagement: rating,
  wetSkill: rating,
  reliability: rating,
  incidentAvoidance: rating,
  pitExecution: rating,
});

export function parseRatings(input: unknown): Ratings {
  return ratingsSchema.parse(input);
}

export interface Team { id: TeamId; name: string; color: string; accent: string }
export interface Driver {
  id: string;
  name: string;
  abbreviation: string;
  number: number;
  nationality: string;
  teamId: TeamId;
  color: string;
  ratings: Ratings;
}

export interface RaceConfig {
  seed: string;
  laps: 56;
  presentationMinutes: number;
  weather: Weather;
  /** Non-sunny races vary by default; sunny races opt in explicitly. */
  dynamicWeather?: boolean;
  safetyCars: boolean;
  incidents: boolean;
}
