import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import type { RaceState } from '../simulation/events';
import { getClassification, getIntervals } from '../simulation/selectors';
import { formatDuration, formatRaceGap, titleCase } from './formatters';

export function Leaderboard({ snapshot, selectedDriverId, onSelect }: {
  snapshot: Readonly<RaceState>;
  selectedDriverId: string | null;
  onSelect(driverId: string): void;
}) {
  const classification = getClassification(snapshot);
  const intervals = getIntervals(snapshot);
  const leader = classification[0];
  return (
    <section className="timing-tower" aria-label="Race classification">
      <header className="panel-kicker"><span>Live timing</span><span>{classification.length} runners</span></header>
      <ol className="timing-list">
        {classification.map((car, index) => {
          const driver = DRIVERS_2026.find((item) => item.id === car.driverId)!;
          const team = TEAMS_2026.find((item) => item.id === driver.teamId)!;
          const selected = selectedDriverId === driver.id;
          const position = car.status === 'finished' ? car.finishPosition : index + 1;
          const statusText = car.status === 'retired'
            ? 'Retired'
            : car.pitState !== 'track' ? `PIT · ${titleCase(car.pitState)}`
              : car.damage > 0.35 ? '⚠ Damage' : null;
          return (
            <li key={driver.id}>
              <button
                type="button"
                className="timing-row"
                aria-label={`Follow ${driver.name}`}
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(driver.id)}
                style={{ '--team-color': team.color } as React.CSSProperties}
              >
                <span className="timing-row__position">{position.toString().padStart(2, '0')}</span>
                <span className="timing-row__driver"><strong>{driver.abbreviation}</strong><small>{driver.name}</small></span>
                <span className="timing-row__gap">{formatRaceGap(car, leader, snapshot.events, { intervalSeconds: intervals.get(driver.id) })}</span>
                <span className="timing-row__laps"><small>LAST</small>{formatDuration(car.timing.lastLap)}</span>
                <span className="timing-row__laps"><small>BEST</small>{formatDuration(car.timing.bestLap)}</span>
                <span className={`tire tire--${car.tire.compound}`} title={`${Math.round(car.tire.wear * 100)}% tire wear`}>
                  {titleCase(car.tire.compound)}
                </span>
                {statusText && <span className={`timing-row__status timing-row__status--${car.status}`}>{statusText}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
