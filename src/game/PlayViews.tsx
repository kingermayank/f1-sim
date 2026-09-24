import { useProgress } from '@react-three/drei';
import { useCallback, useEffect, useRef, useState } from 'react';
import { findCircuit } from '../content/circuits';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import { routeHref } from '../shell/router';
import { GameHud } from './GameHud';
import { GameScene } from './GameScene';
import { TouchControls, useCoarsePointer } from './TouchControls';
import { driverName, formatGap, formatLapTime, gameStore, teamOfDriver, useGameStore } from './game-store';

const CAR_NAMES: Record<string, string> = {
  'red-bull': 'RB21', ferrari: 'SF-25', mclaren: 'MCL39', 'aston-martin': 'AMR25',
  alpine: 'A525', williams: 'FW47', 'racing-bulls': 'VCARB01',
};

function teamOf(teamId: string) {
  return TEAMS_2026.find((team) => team.id === teamId) ?? TEAMS_2026[0];
}

/** The race itself. */
export function PlayRaceView() {
  const phase = useGameStore((state) => state.phase);
  const ready = useGameStore((state) => state.ready);
  const loading = useProgress((state) => state.active);
  const [muted, setMuted] = useState(false);
  const [warm, setWarm] = useState(false);
  const onWarm = useCallback(() => setWarm(true), []);
  const touch = useCoarsePointer();

  // Landing here directly without configuring: send to the picker.
  useEffect(() => {
    if (gameStore.getState().phase === 'setup') window.location.hash = '#/play';
  }, []);

  // Give the fully loaded scene two painted frames before revealing it. This
  // keeps the WebGL material handoff stable without requiring another click.
  useEffect(() => {
    if (phase !== 'intro' || ready || loading || !warm) return;

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const state = gameStore.getState();
        if (state.phase === 'intro' && !state.ready) state.setReady(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [loading, phase, ready, warm]);

  return (
    <div className={touch ? 'game-shell game-shell--touch' : 'game-shell'}>
      <GameScene muted={muted} lite={touch} onWarm={onWarm} />
      <GameHud />
      {phase === 'intro' && !ready && <LoadingScreen warm={warm} />}
      {touch && <TouchControls />}
      <div className="game-topbar">
        <a className="shell-btn" href="#/play">← Choose race</a>
        <button type="button" className="shell-btn" aria-pressed={muted} onClick={() => setMuted((value) => !value)}>
          {muted ? 'Unmute' : 'Mute'}
        </button>
      </div>
      <PauseList muted={muted} setMuted={setMuted} />
      {phase === 'finished' && <RaceResultOverlay />}
    </div>
  );
}

/** Loading progress while the circuit, cars, and shaders become race-ready. */
function LoadingScreen({ warm }: { warm: boolean }) {
  const progress = useProgress((state) => state.progress);
  const active = useProgress((state) => state.active);
  const driverId = useGameStore((state) => state.driverId);
  const team = teamOfDriver(driverId);
  const circuit = findCircuit('shanghai')!;
  const done = !active && warm;
  return (
    <div className="game-loading" role="status" aria-live="polite" style={{ '--team': team.color } as React.CSSProperties}>
      <p className="game-loading__eyebrow">Round {circuit.round} · {circuit.grandPrix}</p>
      <h2 className="game-loading__title">{circuit.name}</h2>
      <div className="game-loading__bar" aria-hidden="true"><span style={{ width: `${done ? 100 : Math.max(4, progress * 0.92)}%` }} /></div>
      <p className="game-loading__status">{active ? `Loading ${Math.round(progress)}%` : done ? 'Starting race' : 'Warming up shaders'}</p>
    </div>
  );
}

/** Resume first, then the few actions that leave or change the race. The circuit stays visible behind it. */
function PauseList({ muted, setMuted }: { muted: boolean; setMuted: (value: boolean | ((value: boolean) => boolean)) => void }) {
  const paused = useGameStore((state) => state.paused);
  const resume = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (paused) resume.current?.focus(); }, [paused]);
  if (!paused) return null;
  return (
    <div className="game-pause" role="dialog" aria-modal="true" aria-label="Paused">
      <div className="game-pause__sheet">
        <p className="game-pause__label">Paused</p>
        <button ref={resume} type="button" className="game-pause__row" onClick={() => gameStore.getState().togglePause()}>Resume</button>
        <button type="button" className="game-pause__row" onClick={() => gameStore.getState().restart()}>Restart</button>
        <button type="button" className="game-pause__row" aria-pressed={muted} onClick={() => setMuted((value) => !value)}>{muted ? 'Unmute' : 'Mute'}</button>
        <a className="game-pause__row" href="#/play">Choose race</a>
      </div>
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

  const headline = finishPosition === 1 ? 'You won' : finishPosition && finishPosition <= 3 ? 'On the podium' : 'Classified';

  if (!revealed) {
    return (
      <div className="game-finish" role="status" style={{ '--team': team.color } as React.CSSProperties}>
        <p className="game-finish__circuit">{circuit.name}</p>
        <p className="game-finish__pos">P{finishPosition}</p>
        <p className="game-finish__note">{headline}</p>
      </div>
    );
  }

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

        <div className="game-result__classification" tabIndex={0} aria-label="Race classification">
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
        </div>

        <div className="game-result__foot">
          <ol className="game-result__laps" aria-label="Your laps">
            {lapTimes.map((record) => (
              <li key={record.lap} className={record.seconds === bestLap ? 'is-best' : undefined}>
                <span>L{record.lap}</span><span>{formatLapTime(record.seconds)}</span>
              </li>
            ))}
          </ol>
          <div className="shell-actions">
            <button type="button" className="shell-btn shell-btn--primary" onClick={() => gameStore.getState().restart()}>Race Again</button>
            <a className="shell-btn" href="#/play">Change Car</a>
            <a className="shell-btn" href={routeHref('home')}>Home</a>
          </div>
        </div>
      </div>
    </div>
  );
}
