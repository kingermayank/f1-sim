import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import type { RaceState } from '../simulation/events';
import { getClassification, getIntervals } from '../simulation/selectors';
import { formatDuration, formatRaceGap, titleCase } from './formatters';
import { SHANGHAI_TRACK } from '../track/shanghai-track';

export function driverSpeedKph(normalizedLapsPerSecond: number): number {
  return normalizedLapsPerSecond * SHANGHAI_TRACK.lengthMeters * 3.6;
}

export function DriverPanel({ snapshot, selectedDriverId }: {
  snapshot: Readonly<RaceState>;
  selectedDriverId: string | null;
}) {
  const classification = getClassification(snapshot);
  const car = classification.find((item) => item.driverId === selectedDriverId) ?? classification[0];
  if (!car) return null;
  const driver = DRIVERS_2026.find((item) => item.id === car.driverId)!;
  const team = TEAMS_2026.find((item) => item.id === driver.teamId)!;
  const intervals = getIntervals(snapshot);
  const position = classification.indexOf(car) + 1;
  const gap = formatRaceGap(car, classification[0], snapshot.events, {
    intervalSeconds: intervals.get(driver.id),
    leaderLabel: 'Leader',
  });
  const sectors = ([1, 2, 3] as const).map((sector) => [...snapshot.events].reverse().find((event) => event.type === 'sector' && event.driverId === car.driverId && event.sector === sector));
  const pitStops = snapshot.events.filter((event) => event.type === 'pit-entry' && event.driverId === car.driverId).length;
  const damagePercent = Math.round(car.damage * 100);
  const condition = damagePercent === 0 ? 'Clear' : damagePercent < 20 ? 'Light' : damagePercent < 50 ? 'Moderate' : 'Heavy';
  const pitPlan = car.pitState !== 'track' ? titleCase(car.pitState) : car.targetLine === 'pit' ? 'Pit now' : null;
  const status = car.status === 'running'
    ? titleCase(car.pitState === 'track' ? car.targetLine : car.pitState)
    : car.status === 'finished' ? 'Finished' : 'Retired';
  return (
    <article className="driver-panel" style={{ '--team-color': team.color } as React.CSSProperties}>
      <div className="driver-panel__identity">
        <span className="driver-panel__position">P{position}</span>
        <div><p>{team.name} · #{driver.number}</p><h2>{driver.name}</h2></div>
        <strong>{driver.abbreviation}</strong>
      </div>
      <dl className="telemetry-grid">
        <div><dt>Interval</dt><dd>{gap}</dd></div>
        <div><dt>Speed</dt><dd>{Math.round(driverSpeedKph(car.speed))} <small>km/h</small></dd></div>
        <div><dt>Last lap</dt><dd>{formatDuration(car.timing.lastLap)}</dd></div>
        <div><dt>Best lap</dt><dd>{formatDuration(car.timing.bestLap)}</dd></div>
        <div><dt>Tire</dt><dd>{titleCase(car.tire.compound)} · {Math.round(car.tire.wear * 100)}%</dd></div>
        <div><dt>Status</dt><dd>{status}</dd></div>
        {sectors.map((event, index) => <div key={index}><dt>S{index + 1}</dt><dd>{event?.type === 'sector' ? formatDuration(event.sectorTime) : '—'}</dd></div>)}
        <div className="telemetry-grid__wide"><dt>Strategy / pit plan</dt><dd>{pitStops} {pitStops === 1 ? 'stop' : 'stops'} · {titleCase(car.tire.compound)} stint{pitPlan ? ` · ${pitPlan}` : ''}</dd></div>
        <div className="telemetry-grid__wide"><dt>Condition</dt><dd>{condition} · {damagePercent}% damage</dd></div>
      </dl>
    </article>
  );
}
