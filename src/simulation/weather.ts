import type { Weather } from '../domain/race-types';
import type { Prng } from './prng';

export interface WeatherTransition {
  lap: number;
  weather: Weather;
}

/** Builds a small, deterministic forecast whose entries always change conditions. */
export function createWeatherSchedule(
  initialWeather: Weather,
  raceLaps: number,
  prng: Prng,
  enabled: boolean,
): readonly WeatherTransition[] {
  if (!enabled) return [];

  const firstLap = Math.min(raceLaps - 2, Math.round(prng.range(16, 34)));
  const firstWeather: Weather = initialWeather === 'rain'
    ? 'cloudy'
    : initialWeather === 'cloudy'
      ? (prng.chance(0.55) ? 'rain' : 'sunny')
      : 'cloudy';
  const secondLap = Math.min(raceLaps - 1, Math.max(firstLap + 8, Math.round(prng.range(48, 68))));
  const secondWeather: Weather = firstWeather === 'rain'
    ? 'cloudy'
    : firstWeather === 'cloudy'
      ? (prng.chance(0.6) ? 'sunny' : 'rain')
      : 'cloudy';

  return [
    { lap: firstLap, weather: firstWeather },
    { lap: secondLap, weather: secondWeather },
  ];
}

export function weatherTrackTemperature(weather: Weather): number {
  return weather === 'sunny' ? 0.88 : weather === 'cloudy' ? 0.7 : 0.55;
}
