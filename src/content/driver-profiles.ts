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
