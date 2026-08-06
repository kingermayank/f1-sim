import { useEffect, useState } from 'react';
import {
  formatGap, formatRaceDuration, raceSession, sessionDrivers, sessionResult,
  type OpenF1Driver, type OpenF1Result,
} from '../data/openf1';

type Status = 'idle' | 'loading' | 'ready' | 'unavailable';

/**
 * Real classification for a round, pulled live from OpenF1.
 *
 * Strictly additive: if the request fails, is blocked, or the race has not run,
 * the panel says so plainly rather than blocking the page or inventing a result.
 */
export function RaceResult({ meetingKey, raceDate }: { meetingKey?: number; raceDate?: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [rows, setRows] = useState<OpenF1Result[]>([]);
  const [drivers, setDrivers] = useState<Map<number, OpenF1Driver>>(new Map());

  const inFuture = Boolean(raceDate && raceDate > new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (!meetingKey || inFuture) return undefined;
    let cancelled = false;
    setStatus('loading');

    (async () => {
      const session = await raceSession(meetingKey);
      if (!session) { if (!cancelled) setStatus('unavailable'); return; }
      const [result, entrants] = await Promise.all([
        sessionResult(session.session_key),
        sessionDrivers(session.session_key),
      ]);
      if (cancelled) return;
      if (!result || result.length === 0) { setStatus('unavailable'); return; }
      setRows(result.slice(0, 10));
      setDrivers(new Map((entrants ?? []).map((driver) => [driver.driver_number, driver])));
      setStatus('ready');
    })();

    return () => { cancelled = true; };
  }, [meetingKey, inFuture]);

  if (!meetingKey && !inFuture) return null;

  return (
    <section className="panel panel--tight result-panel" aria-label="Official race result">
      <h3>Official result</h3>
      {inFuture && <p>This round has not been raced yet.</p>}
      {!inFuture && status === 'loading' && <p>Loading the real classification…</p>}
      {!inFuture && status === 'unavailable' && (
        <p>Live results are unavailable right now. The simulation does not depend on them.</p>
      )}
      {!inFuture && status === 'ready' && (
        <>
          <table className="result-table">
            <caption className="visually-hidden">Top ten finishers</caption>
            <thead>
              <tr><th scope="col">Pos</th><th scope="col">Driver</th><th scope="col">Team</th><th scope="col">Gap</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const driver = drivers.get(row.driver_number);
                return (
                  <tr key={row.driver_number}>
                    <td className="result-table__pos">{row.dnf ? 'DNF' : row.position ?? '—'}</td>
                    <td>{driver?.full_name ?? `#${row.driver_number}`}</td>
                    <td className="result-table__team">{driver?.team_name ?? '—'}</td>
                    <td className="result-table__gap">
                      {row.position === 1 ? formatRaceDuration(row.duration) : formatGap(row.gap_to_leader)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="result-panel__source">
            Live data from <a href="https://openf1.org" target="_blank" rel="noreferrer noopener">OpenF1</a>.
          </p>
        </>
      )}
    </section>
  );
}
