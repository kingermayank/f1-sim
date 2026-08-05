import { DRIVERS_2026 } from '../domain/grid-2026';
import type { CarState, RaceEvent } from '../simulation/events';
import type { ImmutableRaceEvent } from '../store/race-store';

export const driverById = new Map(DRIVERS_2026.map((driver) => [driver.id, driver]));

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return minutes > 0
    ? `${minutes}:${remaining.toFixed(3).padStart(6, '0')}`
    : remaining.toFixed(3);
}

export function formatInterval(seconds: number, leader: boolean): string {
  return leader ? 'LEADER' : `+${seconds.toFixed(3)}`;
}

export function formatRaceGap(
  car: CarState,
  leader: CarState | undefined,
  events: readonly (RaceEvent | ImmutableRaceEvent)[],
  options: { intervalSeconds?: number; leaderLabel?: string; retiredLabel?: 'reason' | 'laps' } = {},
): string {
  if (!leader || car.driverId === leader.driverId) return options.leaderLabel ?? 'LEADER';
  if (car.status === 'finished') {
    return leader.status === 'finished'
      ? `+${Math.max(0, car.timing.totalTime - leader.timing.totalTime).toFixed(3)}`
      : 'FINISHED';
  }
  if (car.status === 'retired') {
    const retirement = [...events].reverse().find((event) => event.type === 'retirement' && event.driverId === car.driverId);
    if (options.retiredLabel !== 'laps' && retirement?.type === 'retirement') return `DNF · ${titleCase(retirement.reason)}`;
    const lapsBehind = Math.max(1, leader.lap - car.lap);
    return `+${lapsBehind} ${lapsBehind === 1 ? 'lap' : 'laps'}`;
  }
  return formatInterval(options.intervalSeconds ?? 0, false);
}

export function titleCase(value: string): string {
  return value.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export function formatRaceEvent(event: RaceEvent | ImmutableRaceEvent): string {
  const driver = 'driverId' in event ? driverById.get(event.driverId) : undefined;
  switch (event.type) {
    case 'start': return 'The Monaco race is underway';
    case 'sector': return `${driver?.abbreviation ?? event.driverId} completed sector ${event.sector}`;
    case 'lap': return `${driver?.abbreviation ?? event.driverId} set a ${formatDuration(event.lapTime)} lap`;
    case 'overtake': return `${driverById.get(event.attackerId)?.abbreviation ?? event.attackerId} passed ${driverById.get(event.defenderId)?.abbreviation ?? event.defenderId} for P${event.position}`;
    case 'pit-entry': return `${driver?.abbreviation ?? event.driverId} entered the pit lane`;
    case 'pit-exit': return `${driver?.abbreviation ?? event.driverId} rejoined from the pits`;
    case 'tire-change': return `${driver?.abbreviation ?? event.driverId} changed to ${event.compound} tires`;
    case 'incident': return `${event.severity === 'major' ? 'Major' : 'Minor'} incident for ${event.driverIds.map((id) => driverById.get(id)?.abbreviation ?? id).join(' and ')}`;
    case 'retirement': return `${driver?.abbreviation ?? event.driverId} retired: ${titleCase(event.reason)}`;
    case 'flag': return `${titleCase(event.flag)} flag deployed`;
    case 'weather': return `Weather changed to ${event.weather}`;
    case 'finish': return `${driver?.abbreviation ?? event.driverId} finished P${event.position}`;
  }
}
