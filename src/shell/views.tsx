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

/* ------------------------------------------------------------------ home -- */

export function HomeView() {
  return (
    <div className="shell-view lights-out-view">
      {/* Pass 18g — atmosphere only: absolute cover+darken, never in document flow */}
      <div className="lights-out-atmosphere" aria-hidden="true">
        <img
          className="lights-out-atmosphere__img"
          src="/assets/lights-out-bg.jpg"
          alt=""
          decoding="async"
        />
        <div className="lights-out-atmosphere__veil" />
      </div>
      <div className="lights-out-wash" aria-hidden="true">
        <span>LIGHTS OUT</span>
        <span>HOW TO RACE</span>
      </div>
      <div className="lights-out-container">
        <div className="start-lights" aria-hidden="true">
          <div className="start-light-pod">
            <div className="start-light" />
            <div className="start-light" />
          </div>
          <div className="start-light-pod">
            <div className="start-light" />
            <div className="start-light" />
          </div>
          <div className="start-light-pod">
            <div className="start-light" />
            <div className="start-light" />
          </div>
          <div className="start-light-pod">
            <div className="start-light" />
            <div className="start-light" />
          </div>
          <div className="start-light-pod">
            <div className="start-light" />
            <div className="start-light" />
          </div>
        </div>
        
        <p className="session-ready">SESSION READY</p>
        <h1 className="lights-out-title">LIGHTS OUT</h1>
        <p className="lights-out-lede">One click. One car. One race.</p>
        
        <a className="shell-btn shell-btn--primary lights-out-cta" href={routeHref('lock-in')}>
          WATCH THE RACE
        </a>
        <p className="lights-out-hint">Watch opens lock-in · pick circuit + primary driver, then go racing.</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- lock-in -- */

export function LockInView() {
  const [selectedCircuit, setSelectedCircuit] = useState<string>(() => {
    if (typeof window === 'undefined') return 'shanghai';
    return localStorage.getItem('apex:circuit') ?? 'shanghai';
  });
  
  const [selectedDriver, setSelectedDriver] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('apex:driver');
  });
  const [circuitStamp, setCircuitStamp] = useState<string | null>(null);
  const [driverStamp, setDriverStamp] = useState<string | null>(null);
  const [confirmSlam, setConfirmSlam] = useState(false);

  const stampCircuit = (id: string) => {
    setSelectedCircuit(id);
    setCircuitStamp(id);
    window.setTimeout(() => setCircuitStamp((cur) => (cur === id ? null : cur)), 240);
  };

  const stampDriver = (id: string) => {
    setSelectedDriver(id);
    setDriverStamp(id);
    window.setTimeout(() => setDriverStamp((cur) => (cur === id ? null : cur)), 200);
  };

  const handleConfirm = () => {
    setConfirmSlam(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem('apex:circuit', selectedCircuit);
      if (selectedDriver) {
        localStorage.setItem('apex:driver', selectedDriver);
      }
    }
    window.setTimeout(() => {
      window.location.hash = '#/race';
    }, 220);
  };

  const circuit = findCircuit(selectedCircuit);
  const displayedDrivers = DRIVERS_2026.slice(0, 8);

  return (
    <div className="shell-view lock-in-view">
      <header className="lock-in-header">
        <a className="shell-mark" href={routeHref('home')} aria-label="Back to APEX home">
          <span>A</span>
        </a>
        <p className="lock-in-breadcrumb">
          LOCK-IN · <strong>BEFORE LIGHTS OUT</strong>
        </p>
      </header>

      <section className="lock-in-section">
        <h2 className="lock-in-kicker">1 · CIRCUIT</h2>
        <div className="circuit-chips">
          {PLAYABLE_CIRCUITS.map((c) => (
            <button
              key={c.id}
              className={`circuit-chip ${selectedCircuit === c.id ? 'is-selected' : ''} ${circuitStamp === c.id ? 'is-stamping' : ''}`}
              onClick={() => stampCircuit(c.id)}
              type="button"
            >
              <span className="circuit-chip__map" aria-hidden="true">
                <CircuitMap circuit={c} />
              </span>
              <span className="circuit-chip__meta">
                <strong>{c.name}</strong>
                <span>{c.countryCode} · {c.lengthKm.toFixed(3)} km · {c.laps}L</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="lock-in-section">
        <h2 className="lock-in-kicker">2 · PRIMARY DRIVER / CAR</h2>
        <div className="driver-grid">
          {displayedDrivers.map((driver) => {
            const team = teamOf(driver.teamId);
            const isSelected = selectedDriver === driver.id;
            return (
              <button
                key={driver.id}
                className={`driver-card ${isSelected ? 'is-selected' : ''} ${driverStamp === driver.id ? 'is-stamping' : ''}`}
                onClick={() => stampDriver(driver.id)}
                style={{ '--team-color': team.color } as React.CSSProperties}
                type="button"
              >
                <div className="driver-card__header">
                  <strong>{driver.abbreviation}</strong>
                  <span className="driver-card__default">{isSelected ? 'DEFAULT' : ''}</span>
                </div>
                <p className="driver-card__name">{driver.name}</p>
                <p className="driver-card__team">{team.name}</p>
              </button>
            );
          })}
        </div>
      </section>

      <footer className="lock-in-footer">
        <p className="lock-in-summary">
          {circuit?.name ?? 'Shanghai'} · {selectedDriver ? DRIVERS_2026.find(d => d.id === selectedDriver)?.abbreviation : 'NOR'} (McLaren) locked as primary.
        </p>
        <button
          className={`shell-btn shell-btn--primary lock-in-confirm ${selectedCircuit && selectedDriver ? 'is-armed' : ''} ${confirmSlam ? 'is-slamming' : ''}`}
          onClick={handleConfirm}
          type="button"
          disabled={!selectedDriver}
        >
          CONFIRM → RACE
        </button>
      </footer>
    </div>
  );
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
