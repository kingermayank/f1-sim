import { useGameStore } from './game-store';

function fmt(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function GameHud() {
  const phase = useGameStore((state) => state.phase);
  const countdown = useGameStore((state) => state.countdown);
  const speed = useGameStore((state) => state.car.speed);
  const gear = useGameStore((state) => state.gear);
  const rpm = useGameStore((state) => state.rpm);
  const lap = useGameStore((state) => state.lap);
  const laps = useGameStore((state) => state.laps);
  const position = useGameStore((state) => state.position);
  const fieldSize = useGameStore((state) => state.fieldSize);
  const gap = useGameStore((state) => state.gapAheadSeconds);
  const drsAvailable = useGameStore((state) => state.drsAvailable);
  const drsActive = useGameStore((state) => state.drsActive);
  const onTrack = useGameStore((state) => state.onTrack);
  const bestLap = useGameStore((state) => state.bestLap);
  const elapsed = useGameStore((state) => state.elapsed);
  const currentLapStart = useGameStore((state) => state.currentLapStart);

  const kph = Math.round(Math.abs(speed) * 3.6);

  return (
    <div className="game-hud" aria-live="off">
      {phase === 'countdown' && (
        <div className="game-hud__countdown" role="status" aria-live="assertive">
          {countdown > 0.2 ? Math.ceil(countdown) : 'GO'}
        </div>
      )}

      <div className="game-hud__top">
        <div className="game-hud__pos">
          <span className="game-hud__big">P{position}</span>
          <span className="game-hud__small">of {fieldSize}</span>
        </div>
        <div className="game-hud__lap">
          <span className="game-hud__big">{Math.max(1, Math.min(lap + 1, laps))}<span className="game-hud__small"> / {laps}</span></span>
          <span className="game-hud__small">LAP</span>
        </div>
        <div className="game-hud__times">
          <div><span className="game-hud__label">Current</span><span className="game-hud__mono">{fmt(lap >= 0 && phase === 'racing' ? elapsed - currentLapStart : null)}</span></div>
          <div><span className="game-hud__label">Best</span><span className="game-hud__mono">{fmt(bestLap)}</span></div>
          <div><span className="game-hud__label">Gap ahead</span><span className="game-hud__mono">{gap === null ? 'Leader' : `+${gap.toFixed(2)}s`}</span></div>
        </div>
      </div>

      <div className="game-hud__bottom">
        <div className={`game-hud__drs${drsActive ? ' is-active' : drsAvailable ? ' is-available' : ''}`} aria-label={drsActive ? 'DRS open' : drsAvailable ? 'DRS available, hold Shift' : 'DRS closed'}>
          DRS
        </div>
        <div className="game-hud__speedo">
          <div className="game-hud__rpm" aria-hidden="true">
            <div className="game-hud__rpm-fill" style={{ width: `${Math.round(rpm * 100)}%` }} />
          </div>
          <div className="game-hud__speed">
            <span className="game-hud__kph">{kph}</span>
            <span className="game-hud__unit">km/h</span>
            <span className="game-hud__gear">{gear}</span>
          </div>
        </div>
        {!onTrack && <div className="game-hud__warn" role="status">Off track — press R to reset</div>}
      </div>

      <div className="game-hud__keys" aria-hidden="true">
        <span><b>W</b> throttle</span><span><b>S</b> brake</span><span><b>A</b>/<b>D</b> steer</span><span><b>Shift</b> DRS</span><span><b>R</b> reset</span>
      </div>
    </div>
  );
}
