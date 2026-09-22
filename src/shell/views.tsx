import { useState } from 'react';
import { CIRCUITS, findCircuit, PLAYABLE_CIRCUITS, type Circuit, type CornerNote } from '../content/circuits';
import { DRIVER_PROFILES, FULL_GRID_2026, STYLE_LABELS, findProfile } from '../content/driver-profiles';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import { CircuitMap } from './CircuitMap';
import { RaceResult } from './RaceResult';
import { routeHref } from './router';

const CAR_NAMES: Record<string, string> = {
  'red-bull': 'RB21',
  ferrari: 'SF-25',
  mclaren: 'MCL39',
  'aston-martin': 'AMR25',
  alpine: 'A525',
  williams: 'FW47',
  'racing-bulls': 'VCARB01',
};

function teamOf(teamId: string) {
  return TEAMS_2026.find((team) => team.id === teamId) ?? TEAMS_2026[0];
}

function driversOf(teamId: string) {
  return DRIVERS_2026.filter((driver) => driver.teamId === teamId);
}

/* -------------------------------------------------------------- circuits -- */

function CircuitCard({ circuit }: { circuit: Circuit }) {
  const playable = circuit.status === 'playable';
  const body = (
    <>
      <div className="circuit-card__map">
        <CircuitMap circuit={circuit} />
      </div>
      <h2>{circuit.name}</h2>
      <p className="circuit-card__meta">
        {circuit.round ? `R${circuit.round} · ` : ''}{circuit.countryCode} · {circuit.lengthKm.toFixed(3)} km · {circuit.laps} laps
      </p>
      <span className={playable ? 'shell-tag shell-tag--live' : 'shell-tag shell-tag--soon'}>
        {playable ? 'Playable' : 'Not built yet'}
      </span>
    </>
  );

  if (!playable) {
    return <div className="circuit-card is-locked" aria-label={`${circuit.name}, not built yet`}>{body}</div>;
  }
  return <a className="circuit-card" href={routeHref('circuit', circuit.id)}>{body}</a>;
}

export function CircuitsView() {
  return (
    <div className="shell-view">
      <header className="shell-head">
        <p className="shell-eyebrow">2026 calendar · {CIRCUITS.length} rounds</p>
        <h1>Circuits</h1>
        <p>
          The real {CIRCUITS.length}-round 2026 calendar. {PLAYABLE_CIRCUITS.length} circuits have
          validated local models and fitted splines; the rest remain planned without invented outlines.
        </p>
      </header>
      <div className="circuit-grid">
        {CIRCUITS.map((circuit) => <CircuitCard key={circuit.id} circuit={circuit} />)}
      </div>
    </div>
  );
}

export function CircuitView({ id }: { id?: string }) {
  const circuit = findCircuit(id);
  const [selected, setSelected] = useState<CornerNote | undefined>(undefined);

  if (!circuit) {
    return (
      <div className="shell-view">
        <header className="shell-head"><h1>Circuit not found</h1>
          <p>That circuit is not in the list. <a href={routeHref('circuits')}>Back to circuits</a>.</p>
        </header>
      </div>
    );
  }

  const corner = selected ?? circuit.corners?.[0];

  return (
    <div className="shell-view">
      <header className="shell-head">
        <p className="shell-eyebrow">{circuit.round ? `Round ${circuit.round} · ` : ''}{circuit.grandPrix ?? circuit.country}</p>
        <h1>{circuit.name}</h1>
        <p>
          {circuit.round ? `Round ${circuit.round} · ` : ''}{circuit.grandPrix ?? circuit.country}
          {circuit.date ? ` · ${new Date(`${circuit.date}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}` : ''}
          {' · '}{circuit.status === 'playable' ? 'Playable now' : 'Not built yet'}
        </p>
      </header>

      <div className="circuit-detail">
        <div className="panel">
          <CircuitMap
            circuit={circuit}
            labelled
            selectedCorner={corner}
            onSelectCorner={setSelected}
          />
          {corner && (
            <div className="corner-note">
              <h3>{corner.label}</h3>
              <p>{corner.note}</p>
            </div>
          )}
          {circuit.corners && (
            <div className="corner-picker">
              {circuit.corners.map((entry) => (
                <button
                  key={entry.label}
                  type="button"
                  className={entry.label === corner?.label ? 'is-active' : undefined}
                  aria-pressed={entry.label === corner?.label}
                  onClick={() => setSelected(entry)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <dl className="spec-grid">
            <div><dt>Length</dt><dd>{circuit.lengthKm.toFixed(3)} km</dd></div>
            <div><dt>Laps</dt><dd>{circuit.laps}</dd></div>
            <div><dt>Turns</dt><dd>{circuit.turns}</dd></div>
            {circuit.longestStraightKm && <div><dt>Longest straight</dt><dd>{circuit.longestStraightKm} km</dd></div>}
            {circuit.drsZones !== undefined && <div><dt>DRS zones</dt><dd>{circuit.drsZones}</dd></div>}
            <div><dt>Grid</dt><dd>{DRIVERS_2026.length} cars</dd></div>
          </dl>
          {circuit.summary && (
            <div className="panel panel--tight">
              <h3>Why this track is interesting</h3>
              <p>{circuit.summary}</p>
            </div>
          )}
          {circuit.status === 'playable' && (
            <div className="shell-actions">
              <a className="shell-btn shell-btn--primary" href={routeHref('race')}>Launch simulation</a>
            </div>
          )}
          <RaceResult meetingKey={circuit.openF1MeetingKey} raceDate={circuit.date} />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- garage -- */

export function GarageView() {
  return (
    <div className="shell-view">
      <header className="shell-head">
        <p className="shell-eyebrow">{TEAMS_2026.length} cars · 2026</p>
        <h1>Garage</h1>
        <p>The {TEAMS_2026.length} teams we hold real car models for. Each is loaded once and shared by both of its drivers.</p>
      </header>
      <div className="car-grid">
        {TEAMS_2026.map((team) => (
          <article className="car-card" key={team.id} style={{ '--team': team.color, '--accent': team.accent } as React.CSSProperties}>
            <div className="car-card__swatch" aria-hidden="true" />
            <div className="car-card__body">
              <h2>{team.name}</h2>
              <p className="car-card__meta">{CAR_NAMES[team.id] ?? 'Chassis'}</p>
              <p className="car-card__drivers">
                {driversOf(team.id).map((driver) => driver.abbreviation).join(' · ')}
              </p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- drivers -- */

export function DriversView() {
  const ordered = [...DRIVERS_2026].sort((a, b) => a.teamId.localeCompare(b.teamId) || a.number - b.number);
  return (
    <div className="shell-view">
      <header className="shell-head">
        <p className="shell-eyebrow">The grid · {DRIVERS_2026.length} in the game</p>
        <h1>Drivers</h1>
        <p>
          Most people pick a driver before they pick a team, and they pick on personality. Here is a
          reason to care about each of the {DRIVERS_2026.length}.
        </p>
      </header>
      <div className="driver-grid">
        {ordered.map((driver) => {
          const team = teamOf(driver.teamId);
          const profile = findProfile(driver.id);
          return (
            <article className="driver-card" key={driver.id} style={{ '--team': team.color } as React.CSSProperties}>
              <div className="driver-card__head">
                <span className="driver-card__number">{driver.number}</span>
                <div>
                  <h2>{driver.name}</h2>
                  <p className="driver-card__team">{team.name} · {driver.nationality}</p>
                </div>
              </div>
              {profile && <p className="driver-card__hook">{profile.hook}</p>}
              {profile && <span className="shell-tag">{STYLE_LABELS[profile.style]}</span>}
            </article>
          );
        })}
      </div>
      <p className="shell-foot">
        Styles above are editorial. The pace, overtaking and tyre-management ratings that actually
        drive the simulation live in the grid definition, so the two can never disagree.
      </p>

      <section className="panel" aria-label="Full 2026 grid">
        <h2>The full 2026 grid</h2>
        <p>
          Eleven teams and {FULL_GRID_2026.length} drivers are racing in 2026, verified against the
          official entry list. We simulate the {FULL_GRID_2026.filter((entry) => entry.simulated).length}{' '}
          drivers whose cars we hold licensed models for — the rest are listed here so the picture stays complete.
        </p>
        <ul className="grid-list">
          {FULL_GRID_2026.map((entry) => (
            <li key={entry.number} className={entry.simulated ? 'grid-list__row is-simulated' : 'grid-list__row'}>
              <span className="grid-list__number">{entry.number}</span>
              <span className="grid-list__name">{entry.name}</span>
              <span className="grid-list__team">{entry.team}</span>
              <span className="grid-list__flag">{entry.simulated ? 'Simulated' : 'Not simulated'}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export { DRIVER_PROFILES };
