import { useEffect, useState } from 'react';
import { findCircuit } from '../content/circuits';
import { findProfile } from '../content/driver-profiles';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import { CircuitMap } from '../shell/CircuitMap';
import { routeHref } from '../shell/router';
import { GameHud } from './GameHud';
import { GameScene } from './GameScene';
import { driverName, formatGap, formatLapTime, gameStore, teamOfDriver, useGameStore, type Difficulty } from './game-store';

const CAR_NAMES: Record<string, string> = {
  'red-bull': 'RB21', ferrari: 'SF-25', mclaren: 'MCL39', 'aston-martin': 'AMR25',
  alpine: 'A525', williams: 'FW47', 'racing-bulls': 'VCARB01',
};

function teamOf(teamId: string) {
  return TEAMS_2026.find((team) => team.id === teamId) ?? TEAMS_2026[0];
}

/** Choose race: circuit → car → go. */
export function ChooseRaceView() {
  // The game drives the Shanghai spline and model specifically; other circuits
  // may be listed as playable for watching before their driving surface is ready.
  const circuit = findCircuit('shanghai')!;
  const [driverId, setDriverId] = useState(DRIVERS_2026[0].id);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [laps, setLaps] = useState(5);
  const driver = DRIVERS_2026.find((candidate) => candidate.id === driverId) ?? DRIVERS_2026[0];
  const team = teamOf(driver.teamId);

  const go = () => {
    gameStore.getState().configure({ driverId, laps, difficulty });
    gameStore.getState().start();
    window.location.hash = '#/play/race';
  };

  return (
    <div className="shell-view">
      <header className="shell-head">
        <h1>Choose race</h1>
        <p>Pick a car and drive it yourself against the field. Keyboard: W/S throttle and brake, A/D steer, Shift for DRS, R to reset, Enter to skip the intro.</p>
      </header>

      <div className="choose-grid">
        <section className="panel choose-card" aria-label="Circuit">
          <p className="choose-card__eyebrow">Round {circuit.round} · {circuit.grandPrix}</p>
          <div className="choose-circuit">
            <div className="choose-circuit__map"><CircuitMap circuit={circuit} /></div>
            <div>
              <h2 className="choose-card__title">{circuit.name}</h2>
              <dl className="choose-specs">
                <div><dt>Length</dt><dd>{circuit.lengthKm.toFixed(3)} km</dd></div>
                <div><dt>Turns</dt><dd>{circuit.turns}</dd></div>
                <div><dt>DRS zones</dt><dd>{circuit.drsZones}</dd></div>
                <div><dt>Longest straight</dt><dd>{circuit.longestStraightKm} km</dd></div>
              </dl>
              <p className="choose-card__note">The circuit built for driving so far. More are on the way.</p>
            </div>
          </div>
        </section>

        <section className="panel choose-card choose-card--hero" aria-label="Your car" style={{ '--team': team.color, '--accent': team.accent } as React.CSSProperties}>
          <p className="choose-card__eyebrow">{team.name} · {CAR_NAMES[team.id]}</p>
          <h2 className="choose-hero__name"><span className="choose-hero__num">{driver.number}</span>{driver.name}</h2>
          <p className="choose-hook">{findProfile(driver.id)?.hook}</p>
        </section>

        <section className="panel" aria-label="Car">
          <h2 className="choose-card__eyebrow">Choose your car</h2>
          <div className="choose-cars" role="radiogroup" aria-label="Choose your driver">
            {DRIVERS_2026.map((candidate) => {
              const candidateTeam = teamOf(candidate.teamId);
              const selected = candidate.id === driverId;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={selected ? 'choose-car is-selected' : 'choose-car'}
                  style={{ '--team': candidateTeam.color, '--accent': candidateTeam.accent } as React.CSSProperties}
                  onClick={() => setDriverId(candidate.id)}
                >
                  <span className="choose-car__num">{candidate.number}</span>
                  <span className="choose-car__name">{candidate.name}</span>
                  <span className="choose-car__team">{candidateTeam.name} · {CAR_NAMES[candidateTeam.id]}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel" aria-label="Race settings">
          <h2 className="choose-card__eyebrow">Race</h2>
          <div className="choose-settings">
            <label>
              <span>Laps</span>
              <select value={laps} onChange={(event) => setLaps(Number(event.target.value))}>
                {[3, 5, 8, 10].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>AI pace</span>
              <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard — real F1 pace</option>
              </select>
            </label>
          </div>
          <div className="shell-actions">
            <button type="button" className="shell-btn shell-btn--primary" onClick={go}>
              Race as {driver.name} · {team.name}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/** The race itself. */
export function PlayRaceView() {
  const phase = useGameStore((state) => state.phase);
  const [muted, setMuted] = useState(false);

  // Landing here directly without configuring: send to the picker.
  useEffect(() => {
    if (gameStore.getState().phase === 'setup') window.location.hash = '#/play';
  }, []);

  return (
    <div className="game-shell">
      <GameScene muted={muted} />
      <GameHud />
      <div className="game-topbar">
        <a className="shell-btn" href="#/play">← Choose race</a>
        <button type="button" className="shell-btn" aria-pressed={muted} onClick={() => setMuted((value) => !value)}>
          {muted ? 'Unmute' : 'Mute'}
        </button>
      </div>
      {phase === 'finished' && <RaceResultOverlay />}
    </div>
  );
}

/**
 * The classification, in the style of a race-preview card: every car, race
 * time or gap, best lap, penalties, with the fastest lap marked.
 */
function RaceResultOverlay() {
  const classification = useGameStore((state) => state.classification);
  const finishPosition = useGameStore((state) => state.finishPosition);
  const fieldSize = useGameStore((state) => state.fieldSize);
  const laps = useGameStore((state) => state.laps);
  const lapTimes = useGameStore((state) => state.lapTimes);
  const bestLap = useGameStore((state) => state.bestLap);
  const reactionSeconds = useGameStore((state) => state.reactionSeconds);
  const driverId = useGameStore((state) => state.driverId);
  const [revealed, setRevealed] = useState(false);
  const circuit = findCircuit('shanghai')!;
  const team = teamOfDriver(driverId);
  const driver = DRIVERS_2026.find((candidate) => candidate.id === driverId);
  const winner = classification[0];

  // Let the flag and the cool-down breathe before the sheet comes up.
  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), 2600);
    return () => window.clearTimeout(timer);
  }, []);
  if (!revealed) return null;

  const headline = finishPosition === 1 ? 'You won' : finishPosition && finishPosition <= 3 ? 'On the podium' : 'Classified';

  return (
    <div className="game-result" role="dialog" aria-modal="true" aria-labelledby="game-result-title" style={{ '--team': team.color, '--accent': team.accent } as React.CSSProperties}>
      <div className="game-result__sheet">
        <header className="game-result__head">
          <div>
            <p className="game-result__eyebrow">{circuit.grandPrix} · {laps} laps · Race classification</p>
            <h2 id="game-result-title" className="game-result__title">
              <span className="game-result__pos">P{finishPosition}</span>
              <span>{headline}<small>{driver?.name} · {team.name} · of {fieldSize}</small></span>
            </h2>
          </div>
          <dl className="game-result__stats">
            <div><dt>Race time</dt><dd>{formatLapTime(classification.find((row) => row.isPlayer)?.raceTime ?? null)}</dd></div>
            <div><dt>Best lap</dt><dd>{formatLapTime(bestLap)}</dd></div>
            <div><dt>Reaction</dt><dd>{reactionSeconds === null ? '—' : `${reactionSeconds.toFixed(2)}s`}</dd></div>
            <div><dt>Winner</dt><dd>{winner ? driverName(winner.driverId) : '—'}</dd></div>
          </dl>
        </header>

        <table className="game-result__table">
          <thead>
            <tr><th scope="col">Pos</th><th scope="col">Driver</th><th scope="col">Team</th><th scope="col">Time / gap</th><th scope="col">Best lap</th></tr>
          </thead>
          <tbody>
            {classification.map((row) => {
              const rowDriver = DRIVERS_2026.find((candidate) => candidate.id === row.driverId);
              const rowTeam = teamOfDriver(row.driverId);
              return (
                <tr key={row.driverId} className={row.isPlayer ? 'is-player' : undefined} style={{ '--row-team': rowTeam.color } as React.CSSProperties}>
                  <td className="game-result__cell-pos">{row.position}</td>
                  <td className="game-result__cell-driver"><span className="game-result__bar" aria-hidden="true" />{rowDriver?.name}{row.isPlayer && <em> you</em>}</td>
                  <td className="game-result__cell-team">{rowTeam.name}</td>
                  <td className="game-result__cell-time">
                    {row.lapsDown > 0 ? `+${row.lapsDown} lap${row.lapsDown > 1 ? 's' : ''}` : row.position === 1 ? formatLapTime(row.raceTime) : formatGap(row.gap)}
                    {row.penaltySeconds > 0 && <span className="game-result__penalty" title="Jump start"> +{row.penaltySeconds}s</span>}
                  </td>
                  <td className={`game-result__cell-best${row.fastestLap ? ' is-fastest' : ''}`}>{formatLapTime(row.bestLap)}{row.fastestLap && <span className="game-result__fl" aria-label="Fastest lap">FL</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="game-result__foot">
          <ol className="game-result__laps" aria-label="Your laps">
            {lapTimes.map((record) => (
              <li key={record.lap} className={record.seconds === bestLap ? 'is-best' : undefined}>
                <span>L{record.lap}</span><span>{formatLapTime(record.seconds)}</span>
              </li>
            ))}
          </ol>
          <div className="shell-actions">
            <button type="button" className="shell-btn shell-btn--primary" onClick={() => gameStore.getState().restart()}>Race again</button>
            <a className="shell-btn" href="#/play">Change car</a>
            <a className="shell-btn" href={routeHref('home')}>Home</a>
          </div>
        </div>
      </div>
    </div>
  );
}
