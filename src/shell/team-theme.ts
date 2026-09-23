import type { CSSProperties } from 'react';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';

const SELECTED_DRIVER_KEY = 'apex-selected-driver';
export const TEAM_THEME_EVENT = 'apex-team-theme-change';

export function readSelectedDriverId(): string {
  if (typeof window === 'undefined') return DRIVERS_2026[0].id;
  const stored = window.localStorage.getItem(SELECTED_DRIVER_KEY);
  return DRIVERS_2026.some((driver) => driver.id === stored) ? stored! : DRIVERS_2026[0].id;
}

export function persistSelectedDriverId(driverId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SELECTED_DRIVER_KEY, driverId);
  window.dispatchEvent(new CustomEvent(TEAM_THEME_EVENT, { detail: driverId }));
}

export function teamThemeStyle(driverId: string): CSSProperties {
  const driver = DRIVERS_2026.find((candidate) => candidate.id === driverId) ?? DRIVERS_2026[0];
  const team = TEAMS_2026.find((candidate) => candidate.id === driver.teamId) ?? TEAMS_2026[0];
  const darkText = ['mclaren', 'alpine', 'racing-bulls'].includes(team.id);
  return {
    '--team': team.color,
    '--accent': team.accent,
    '--signal': team.color,
    '--focus': team.color,
    '--on-team': darkText ? '#07100d' : '#ffffff',
  } as CSSProperties;
}
