import { useEffect, useState } from 'react';
import { findCircuit } from '../content/circuits';
import { findProfile } from '../content/driver-profiles';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import { CircuitMap } from '../shell/CircuitMap';
import { routeHref } from '../shell/router';
import { GameHud } from './GameHud';
import { GameScene } from './GameScene';
import { gameStore, useGameStore, type Difficulty } from './game-store';

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
        <p>Pick a circuit and a car, then drive it yourself against the field. Keyboard: W/S throttle and brake, A/D steer, Shift for DRS, R to reset.</p>
      </header>

      <div className="choose-grid">
        <section className="panel" aria-label="Circuit">
          <h2>Circuit</h2>
          <div className="choose-circuit">
            <div className="choose-circuit__map"><CircuitMap circuit={circuit} /></div>
            <div>
              <h3>{circuit.name}</h3>
              <p className="choose-meta">{circuit.countryCode} · {circuit.lengthKm.toFixed(3)} km · {circuit.turns} turns</p>
              <p>The circuit built for driving so far. More are on the way.</p>
            </div>
          </div>
        </section>

        <section className="panel" aria-label="Car">
          <h2>Car</h2>
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
          <p className="choose-hook">{findProfile(driver.id)?.hook}</p>
        </section>

        <section className="panel" aria-label="Race settings">
          <h2>Race</h2>
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

function RaceResultOverlay() {
  const position = useGameStore((state) => state.finishPosition);
  const fieldSize = useGameStore((state) => state.fieldSize);
  const lapTimes = useGameStore((state) => state.lapTimes);
  const bestLap = useGameStore((state) => state.bestLap);
  const driverId = useGameStore((state) => state.driverId);
  const driver = DRIVERS_2026.find((candidate) => candidate.id === driverId);
  const fmt = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    return `${m}:${(seconds - m * 60).toFixed(3).padStart(6, '0')}`;
  };
  return (
    <div className="game-result" role="dialog" aria-modal="true" aria-labelledby="game-result-title">
      <div className="game-result__card">
        <p className="shell-eyebrow">Chequered flag</p>
        <h2 id="game-result-title">P{position} of {fieldSize}</h2>
        <p className="game-result__driver">{driver?.name}</p>
        <dl className="game-result__laps">
          {lapTimes.map((record) => (
            <div key={record.lap} className={record.seconds === bestLap ? 'is-best' : undefined}>
              <dt>Lap {record.lap}</dt><dd>{fmt(record.seconds)}</dd>
            </div>
          ))}
        </dl>
        <p className="game-result__best">Best lap <strong>{bestLap !== null ? fmt(bestLap) : '—'}</strong></p>
        <div className="shell-actions">
          <button type="button" className="shell-btn shell-btn--primary" onClick={() => gameStore.getState().restart()}>Race again</button>
          <a className="shell-btn" href={routeHref('home')}>Home</a>
        </div>
      </div>
    </div>
  );
}
