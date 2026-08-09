import { z } from 'zod';
import type { RaceConfig } from './race-types';

const raceConfigSchema = z.object({
  seed: z.string().min(1),
  laps: z.number().int().min(3).max(78),
  presentationMinutes: z.number().min(5).max(15),
  weather: z.enum(['sunny', 'cloudy', 'rain']),
  dynamicWeather: z.boolean().optional(),
  safetyCars: z.boolean(),
  incidents: z.boolean(),
});

/**
 * A watchable race, not a real Grand Prix distance.
 *
 * The engine fits `laps` into `presentationMinutes`, so those two numbers set
 * how fast everything moves on screen. A real 56-lap distance squeezed into six
 * minutes ran at roughly twelve times real speed, which was far too fast to
 * follow. Twenty laps across ten minutes lands at about 2.5x — roughly five
 * times slower than before, and comfortable to watch.
 *
 * Twenty is also a floor, not a preference: at ten laps the tyres barely wear,
 * so nobody pits and there is no strategy left for Explain Mode to explain.
 *
 * The circuit pages still report Shanghai's real 56-lap distance; that is a
 * fact about the Grand Prix, not a target for the game.
 */
export const DEFAULT_RACE_CONFIG: RaceConfig = {
  seed: 'shanghai-2026-opening-race',
  laps: 20,
  presentationMinutes: 10,
  weather: 'sunny',
  safetyCars: true,
  incidents: true,
};

export function parseRaceConfig(input: unknown): RaceConfig {
  return raceConfigSchema.parse(input);
}
