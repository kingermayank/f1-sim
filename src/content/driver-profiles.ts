/**
 * Editorial hooks for each driver.
 *
 * Research on how people enter the sport is consistent: they pick a driver
 * before a team, and they pick on personality rather than statistics. These
 * one-liners exist so the drivers page gives a newcomer a reason to care,
 * rather than handing them a table of numbers.
 *
 * Ratings are NOT duplicated here — they come from the simulation's own grid
 * definition so the two can never disagree.
 */
export interface DriverProfile {
  driverId: string;
  /** Short, human reason to follow this driver. */
  hook: string;
  /** Surfaced by Find My Driver. */
  style: 'aggressor' | 'strategist' | 'allrounder' | 'prodigy' | 'veteran';
}

export const DRIVER_PROFILES: readonly DriverProfile[] = [
  { driverId: 'verstappen', style: 'aggressor', hook: 'Will not lift. Puts the car somewhere the other driver has to decide whether to crash.' },
  { driverId: 'hadjar', style: 'prodigy', hook: 'Second season, still finding the edges, and quick enough to embarrass a teammate.' },
  { driverId: 'leclerc', style: 'aggressor', hook: 'Devastating over one lap. When qualifying goes right, nobody sees him again.' },
  { driverId: 'hamilton', style: 'veteran', hook: 'Seven titles and the best wet-weather read on the grid. Never out of a race.' },
  { driverId: 'norris', style: 'allrounder', hook: 'Carries the number 1 and races like he is enjoying it, which is rarer than it sounds.' },
  { driverId: 'piastri', style: 'strategist', hook: 'Ice cold. Manages a tyre better than drivers a decade older.' },
  { driverId: 'alonso', style: 'veteran', hook: 'The best defensive driver alive. Getting past him is a project, not a move.' },
  { driverId: 'stroll', style: 'allrounder', hook: 'Comes alive in the rain, where the car matters less and nerve matters more.' },
  { driverId: 'gasly', style: 'strategist', hook: 'Extracts more from a midfield car than it has any right to give.' },
  { driverId: 'colapinto', style: 'aggressor', hook: 'Fearless and occasionally too fearless. Never boring to watch.' },
  { driverId: 'sainz', style: 'strategist', hook: 'The thinking driver. Wins races on the pit wall as much as on track.' },
  { driverId: 'albon', style: 'allrounder', hook: 'Rebuilt his career from nothing. Quietly excellent, rarely makes a mistake.' },
  { driverId: 'lawson', style: 'aggressor', hook: 'Arrived with elbows out and has not retracted them since.' },
  { driverId: 'lindblad', style: 'prodigy', hook: 'The rookie everyone is watching. Raw pace, still learning the rest.' },
];

export const STYLE_LABELS: Record<DriverProfile['style'], string> = {
  aggressor: 'Aggressor',
  strategist: 'Strategist',
  allrounder: 'All-rounder',
  prodigy: 'Prodigy',
  veteran: 'Veteran',
};

export function findProfile(driverId: string): DriverProfile | undefined {
  return DRIVER_PROFILES.find((profile) => profile.driverId === driverId);
}

/**
 * The full real 2026 grid, verified against OpenF1's entry list for the
 * Chinese Grand Prix and formula1.com.
 *
 * Our simulation races a 7-team subset because those are the only cars we hold
 * licensed models for. Listing the complete grid keeps the content honest —
 * these eleven teams and twenty-two drivers are who is actually racing in 2026 —
 * while `simulated` marks who you can currently watch.
 */
export interface GridEntry {
  number: number;
  code: string;
  name: string;
  team: string;
  /** True when this driver is on our simulated grid. */
  simulated: boolean;
}

export const FULL_GRID_2026: readonly GridEntry[] = [
  { number: 3, code: 'VER', name: 'Max Verstappen', team: 'Red Bull Racing', simulated: true },
  { number: 6, code: 'HAD', name: 'Isack Hadjar', team: 'Red Bull Racing', simulated: true },
  { number: 16, code: 'LEC', name: 'Charles Leclerc', team: 'Ferrari', simulated: true },
  { number: 44, code: 'HAM', name: 'Lewis Hamilton', team: 'Ferrari', simulated: true },
  { number: 1, code: 'NOR', name: 'Lando Norris', team: 'McLaren', simulated: true },
  { number: 81, code: 'PIA', name: 'Oscar Piastri', team: 'McLaren', simulated: true },
  { number: 14, code: 'ALO', name: 'Fernando Alonso', team: 'Aston Martin', simulated: true },
  { number: 18, code: 'STR', name: 'Lance Stroll', team: 'Aston Martin', simulated: true },
  { number: 10, code: 'GAS', name: 'Pierre Gasly', team: 'Alpine', simulated: true },
  { number: 43, code: 'COL', name: 'Franco Colapinto', team: 'Alpine', simulated: true },
  { number: 23, code: 'ALB', name: 'Alexander Albon', team: 'Williams', simulated: true },
  { number: 55, code: 'SAI', name: 'Carlos Sainz', team: 'Williams', simulated: true },
  { number: 30, code: 'LAW', name: 'Liam Lawson', team: 'Racing Bulls', simulated: true },
  { number: 41, code: 'LIN', name: 'Arvid Lindblad', team: 'Racing Bulls', simulated: true },
  { number: 12, code: 'ANT', name: 'Kimi Antonelli', team: 'Mercedes', simulated: false },
  { number: 63, code: 'RUS', name: 'George Russell', team: 'Mercedes', simulated: false },
  { number: 31, code: 'OCO', name: 'Esteban Ocon', team: 'Haas F1 Team', simulated: false },
  { number: 87, code: 'BEA', name: 'Oliver Bearman', team: 'Haas F1 Team', simulated: false },
  { number: 5, code: 'BOR', name: 'Gabriel Bortoleto', team: 'Audi', simulated: false },
  { number: 27, code: 'HUL', name: 'Nico Hulkenberg', team: 'Audi', simulated: false },
  { number: 11, code: 'PER', name: 'Sergio Perez', team: 'Cadillac', simulated: false },
  { number: 77, code: 'BOT', name: 'Valtteri Bottas', team: 'Cadillac', simulated: false },
];
