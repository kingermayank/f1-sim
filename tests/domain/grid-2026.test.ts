import { DRIVERS_2026, TEAMS_2026 } from '../../src/domain/grid-2026';
import { DEFAULT_RACE_CONFIG, parseRaceConfig } from '../../src/domain/race-config';
import { parseRatings } from '../../src/domain/race-types';

const expectedDrivers = [
  ['George Russell', 63, 'mercedes'], ['Kimi Antonelli', 12, 'mercedes'],
  ['Charles Leclerc', 16, 'ferrari'], ['Lewis Hamilton', 44, 'ferrari'],
  ['Lando Norris', 1, 'mclaren'], ['Oscar Piastri', 81, 'mclaren'],
  ['Max Verstappen', 3, 'red-bull'], ['Isack Hadjar', 6, 'red-bull'],
  ['Liam Lawson', 30, 'racing-bulls'], ['Arvid Lindblad', 41, 'racing-bulls'],
  ['Pierre Gasly', 10, 'alpine'], ['Franco Colapinto', 43, 'alpine'],
  ['Esteban Ocon', 31, 'haas'], ['Oliver Bearman', 87, 'haas'],
  ['Nico Hulkenberg', 27, 'audi'], ['Gabriel Bortoleto', 5, 'audi'],
  ['Carlos Sainz', 55, 'williams'], ['Alexander Albon', 23, 'williams'],
  ['Fernando Alonso', 14, 'aston-martin'], ['Lance Stroll', 18, 'aston-martin'],
  ['Sergio Perez', 11, 'cadillac'], ['Valtteri Bottas', 77, 'cadillac'],
] as const;

it('contains 11 teams and 22 unique drivers', () => {
  expect(TEAMS_2026).toHaveLength(11);
  expect(DRIVERS_2026).toHaveLength(22);
  expect(new Set(DRIVERS_2026.map((driver) => driver.id)).size).toBe(22);
  expect(new Set(DRIVERS_2026.map((driver) => driver.number)).size).toBe(22);
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

it('validates the 78-lap compressed default race', () => {
  expect(parseRaceConfig(DEFAULT_RACE_CONFIG)).toMatchObject({
    laps: 78,
    presentationMinutes: 6,
    weather: 'sunny',
  });
  expect(parseRaceConfig({ ...DEFAULT_RACE_CONFIG, dynamicWeather: true }).dynamicWeather).toBe(true);
});

it.each([
  [{ ...DEFAULT_RACE_CONFIG, seed: '' }],
  [{ ...DEFAULT_RACE_CONFIG, laps: 77 }],
  [{ ...DEFAULT_RACE_CONFIG, presentationMinutes: 4 }],
  [{ ...DEFAULT_RACE_CONFIG, presentationMinutes: 9 }],
  [{ ...DEFAULT_RACE_CONFIG, weather: 'stormy' }],
])('rejects invalid race configuration %o', (input) => {
  expect(() => parseRaceConfig(input)).toThrow();
});

it('rejects ratings outside the supported range', () => {
  expect(() => parseRatings({ ...DRIVERS_2026[0].ratings, pace: 1.01 })).toThrow();
});
