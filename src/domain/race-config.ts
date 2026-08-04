import { z } from 'zod';
import type { RaceConfig } from './race-types';

const raceConfigSchema = z.object({
  seed: z.string().min(1),
  laps: z.literal(78),
  presentationMinutes: z.number().min(5).max(8),
  weather: z.enum(['sunny', 'cloudy', 'rain']),
  safetyCars: z.boolean(),
  incidents: z.boolean(),
});

export const DEFAULT_RACE_CONFIG: RaceConfig = {
  seed: 'monaco-2026-opening-race',
  laps: 78,
  presentationMinutes: 6,
  weather: 'sunny',
  safetyCars: true,
  incidents: true,
};

export function parseRaceConfig(input: unknown): RaceConfig {
  return raceConfigSchema.parse(input);
}
