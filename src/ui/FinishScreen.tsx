import { useCallback, useState } from 'react';
import { DRIVERS_2026 } from '../domain/grid-2026';
import type { RaceState } from '../simulation/events';
import { getClassification } from '../simulation/selectors';
import { formatDuration, formatRaceGap, titleCase } from './formatters';
import { AccessibleDialog } from './AccessibleDialog';

export function FinishScreen({ snapshot, onReplay, onNewRace }: {
  snapshot: Readonly<RaceState>;
  onReplay(): void;
  onNewRace(): void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const dismiss = useCallback(() => setDismissed(true), []);
  const classification = getClassification(snapshot);
  const best = classification.reduce<typeof classification[number] | null>((fastest, car) => car.timing.bestLap !== null && (!fastest || fastest.timing.bestLap === null || car.timing.bestLap < fastest.timing.bestLap) ? car : fastest, null);
  const incidents = snapshot.events.filter((event) => event.type === 'incident');
  const pitCount = (driverId: string) => snapshot.events.filter((event) => event.type === 'pit-entry' && event.driverId === driverId).length;
  const retirement = (driverId: string) => [...snapshot.events].reverse().find((event) => event.type === 'retirement' && event.driverId === driverId);
  const winner = classification[0];
  if (dismissed) return null;
  return (
    <AccessibleDialog className="finish-screen" labelledBy="finish-title" onClose={dismiss}>
      <header><p className="finish-screen__eyebrow">Chequered flag · 56 laps</p><h2 id="finish-title">Race complete</h2><p>{DRIVERS_2026.find((driver) => driver.id === winner?.driverId)?.name} wins Monaco in {formatDuration(winner?.timing.totalTime ?? 0)}</p></header>
      <div className="finish-facts"><p><span>Fastest lap</span><strong>{best ? `${DRIVERS_2026.find((driver) => driver.id === best.driverId)?.abbreviation} · ${formatDuration(best.timing.bestLap)}` : '—'}</strong></p><p><span>Race control</span><strong>{incidents.length} {incidents.length === 1 ? 'incident' : 'incidents'}</strong></p><p><span>Seed</span><strong>{snapshot.seed}</strong></p></div>
      <section className="incident-recap" aria-labelledby="incident-recap-title"><h3 id="incident-recap-title">Incident recap</h3><ol aria-label="Incident recap">{incidents.length ? incidents.map((incident, index) => <li key={`${incident.tick}:${index}`}><time>T+{(incident.tick * 0.1).toFixed(1)}s</time><span>{titleCase(incident.severity)} incident · {incident.driverIds.map((id) => DRIVERS_2026.find((driver) => driver.id === id)?.name ?? id).join(' and ')}</span></li>) : <li>No incidents recorded</li>}</ol></section>
      <div className="finish-table-wrap"><table aria-label="Final classification"><thead><tr><th>Pos</th><th>Driver</th><th>Time / interval</th><th>Best</th><th>Pits</th><th>Status</th></tr></thead><tbody>{classification.map((car, index) => {
        const driver = DRIVERS_2026.find((item) => item.id === car.driverId)!;
        const reason = retirement(driver.id);
        return <tr key={driver.id}><td>{index + 1}</td><th scope="row">{driver.abbreviation}<small>{driver.name}</small></th><td>{formatRaceGap(car, winner, snapshot.events, { leaderLabel: formatDuration(car.timing.totalTime), retiredLabel: 'laps' })}</td><td>{formatDuration(car.timing.bestLap)}</td><td>{pitCount(driver.id)}</td><td>{car.status === 'retired' && reason?.type === 'retirement' ? `DNF · ${titleCase(reason.reason)}` : titleCase(car.status)}</td></tr>;
      })}</tbody></table></div>
      <footer><button type="button" data-autofocus onClick={onReplay}>Replay this seed</button><button type="button" className="button--accent" onClick={onNewRace}>Start with a new seed</button></footer>
    </AccessibleDialog>
  );
}
