import { DRIVERS_2026, TEAMS_2026 } from '../../src/domain/grid-2026';
import { DEFAULT_RACE_CONFIG, parseRaceConfig } from '../../src/domain/race-config';
import { parseRatings } from '../../src/domain/race-types';

const expectedDrivers = [
  ['Charles Leclerc', 16, 'ferrari'], ['Lewis Hamilton', 44, 'ferrari'],
  ['Lando Norris', 1, 'mclaren'], ['Oscar Piastri', 81, 'mclaren'],
  ['Max Verstappen', 3, 'red-bull'], ['Isack Hadjar', 6, 'red-bull'],
  ['Liam Lawson', 30, 'racing-bulls'], ['Arvid Lindblad', 41, 'racing-bulls'],
  ['Pierre Gasly', 10, 'alpine'], ['Franco Colapinto', 43, 'alpine'],
  ['Carlos Sainz', 55, 'williams'], ['Alexander Albon', 23, 'williams'],
  ['Fernando Alonso', 14, 'aston-martin'], ['Lance Stroll', 18, 'aston-martin'],
] as const;

it('contains 7 teams and 14 unique drivers', () => {
  expect(TEAMS_2026).toHaveLength(7);
  expect(DRIVERS_2026).toHaveLength(14);
  expect(new Set(DRIVERS_2026.map((driver) => driver.id)).size).toBe(14);
  expect(new Set(DRIVERS_2026.map((driver) => driver.number)).size).toBe(14);
});

it('assigns exactly two drivers to every team', () => {
  for (const team of TEAMS_2026) {
    expect(DRIVERS_2026.filter((driver) => driver.teamId === team.id)).toHaveLength(2);
  }
});

it('matches the exact 2026 driver name, number, and team mapping', () => {
  expect(DRIVERS_2026.map(({ name, number, teamId }) => [name, number, teamId])).toEqual(expectedDrivers);
});

it('gives every driver their team display color and bounded ratings', () => {
  const teamColors = new Map(TEAMS_2026.map((team) => [team.id, team.color]));

  for (const driver of DRIVERS_2026) {
    expect(driver.color).toBe(teamColors.get(driver.teamId));
    for (const rating of Object.values(driver.ratings)) {
      expect(rating).toBeGreaterThanOrEqual(0);
      expect(rating).toBeLessThanOrEqual(1);
    }
  }
});

it('validates the default watchable race', () => {
  expect(parseRaceConfig(DEFAULT_RACE_CONFIG)).toMatchObject({
    laps: 20,
    presentationMinutes: 10,
    weather: 'sunny',
  });
  expect(parseRaceConfig({ ...DEFAULT_RACE_CONFIG, dynamicWeather: true }).dynamicWeather).toBe(true);
});

it.each([1, 56, 100])('accepts a supported circuit lap count of %i', (laps) => {
  expect(parseRaceConfig({ ...DEFAULT_RACE_CONFIG, laps }).laps).toBe(laps);
});

it.each([0, 56.5, 101])('rejects an unsupported circuit lap count of %s', (laps) => {
  expect(() => parseRaceConfig({ ...DEFAULT_RACE_CONFIG, laps })).toThrow();
});

it.each([
  [{ ...DEFAULT_RACE_CONFIG, seed: '' }],
  [{ ...DEFAULT_RACE_CONFIG, presentationMinutes: 4 }],
  [{ ...DEFAULT_RACE_CONFIG, presentationMinutes: 16 }],
  [{ ...DEFAULT_RACE_CONFIG, weather: 'stormy' }],
])('rejects invalid race configuration %o', (input) => {
  expect(() => parseRaceConfig(input)).toThrow();
});

it('rejects ratings outside the supported range', () => {
  expect(() => parseRatings({ ...DRIVERS_2026[0].ratings, pace: 1.01 })).toThrow();
});
