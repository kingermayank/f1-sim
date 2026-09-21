import { useEffect, useRef, useState } from 'react';
import { findCircuit } from '../content/circuits';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import { formatLapTime, gameStore, teamOfDriver, useGameStore, type GameEvent } from './game-store';
import { MINIMAP_OUTLINE, MINIMAP_PASSING_ZONES, MINIMAP_START, mapPoint } from './minimap';

const CAR_NAMES: Record<string, string> = {
  'red-bull': 'RB21', ferrari: 'SF-25', mclaren: 'MCL39', 'aston-martin': 'AMR25',
  alpine: 'A525', williams: 'FW47', 'racing-bulls': 'VCARB01',
};

/** Toasts live this long on screen. */
const EVENT_TTL_SECONDS = 3.6;

/**
 * The race HUD. Layout follows broadcast and game convention: position and
 * lap top-left where the eye rests, the gear inside an RPM arc bottom-right
 * where a wheel display would be, a mini-map with every car on the left, and
 * short event toasts top-centre so they never cover the road ahead.
 */
export function GameHud() {
  const phase = useGameStore((state) => state.phase);
  return (
    <div className="game-hud" aria-live="off">
      {phase === 'intro' && <IntroCard />}
      {(phase === 'lights' || phase === 'racing') && <LightsGantry />}
      {phase !== 'intro' && (
        <>
          <Timing />
          <Toasts />
          <Banners />
          <MiniMap />
          <Wheel />
          <OffTrack />
          <Keys />
        </>
      )}
    </div>
  );
}

/** Title card over the flyover: the round, the circuit, and who you are driving. */
function IntroCard() {
  const driverId = useGameStore((state) => state.driverId);
  const laps = useGameStore((state) => state.laps);
  const introSeconds = useGameStore((state) => state.introSeconds);
  const circuit = findCircuit('shanghai')!;
  const driver = DRIVERS_2026.find((candidate) => candidate.id === driverId) ?? DRIVERS_2026[0];
  const team = teamOfDriver(driverId);
  // Two cards: the race, then the driver, cut on the second camera shot.
  const showDriver = introSeconds > 6.5;
  return (
    <div className="game-intro" style={{ '--team': team.color, '--accent': team.accent } as React.CSSProperties}>
      {!showDriver ? (
        <div className="game-intro__card game-intro__card--race" key="race">
          <p className="game-intro__eyebrow">Round {circuit.round} · {circuit.grandPrix}</p>
          <h2 className="game-intro__title">Shanghai</h2>
          <p className="game-intro__meta">
            <span>{circuit.lengthKm.toFixed(3)} km</span><span>{circuit.turns} turns</span><span>{laps} laps</span><span>{circuit.drsZones} DRS zones</span>
          </p>
          <svg className="game-intro__map" viewBox="0 0 100 100" aria-hidden="true">
            <path d={MINIMAP_OUTLINE} className="minimap__track" />
            {MINIMAP_PASSING_ZONES.map((d) => <path key={d} d={d} className="minimap__drs" />)}
          </svg>
        </div>
      ) : (
        <div className="game-intro__card game-intro__card--driver" key="driver">
          <p className="game-intro__eyebrow">{team.name} · {CAR_NAMES[team.id]}</p>
          <h2 className="game-intro__title"><span className="game-intro__num">{driver.number}</span>{driver.name}</h2>
          <p className="game-intro__meta"><span>Starting P{DRIVERS_2026.length}</span><span>Back of the grid</span></p>
        </div>
      )}
      <button type="button" className="game-intro__skip" onClick={() => gameStore.getState().skipIntro()}>
        Skip <kbd>Enter</kbd>
      </button>
    </div>
  );
}

/** Five columns of two red lights, lit one column a second; all out means go. */
function LightsGantry() {
  const lights = useGameStore((state) => state.lights);
  const phase = useGameStore((state) => state.phase);
  const elapsed = useGameStore((state) => state.elapsed);
  const jumpStart = useGameStore((state) => state.jumpStart);
  // Keep the gantry up briefly after lights out so the "go" reads.
  const visible = phase === 'lights' || (phase === 'racing' && elapsed < 1.6);
  if (!visible) return null;
  const out = phase === 'racing';
  return (
    <div className={`game-lights${out ? ' is-out' : ''}`} role="status" aria-live="assertive" aria-label={out ? 'Lights out' : `${lights} of 5 lights`}>
      <div className="game-lights__gantry" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((column) => (
          <div key={column} className={`game-lights__column${!out && column < lights ? ' is-lit' : ''}`}>
            <span /><span />
          </div>
        ))}
      </div>
      <p className="game-lights__label">{out ? (jumpStart ? 'Jump start' : "It's lights out") : 'Hold on the grid'}</p>
    </div>
  );
}

function Timing() {
  const position = useGameStore((state) => state.position);
  const fieldSize = useGameStore((state) => state.fieldSize);
  const lap = useGameStore((state) => state.lap);
  const laps = useGameStore((state) => state.laps);
  const phase = useGameStore((state) => state.phase);
  const elapsed = useGameStore((state) => state.elapsed);
  const currentLapStart = useGameStore((state) => state.currentLapStart);
  const bestLap = useGameStore((state) => state.bestLap);
  const gapAhead = useGameStore((state) => state.gapAheadSeconds);
  const gapBehind = useGameStore((state) => state.gapBehindSeconds);
  const driverId = useGameStore((state) => state.driverId);
  const team = teamOfDriver(driverId);
  const finalLap = useGameStore((state) => state.finalLap);
  return (
    <div className="game-timing" style={{ '--team': team.color } as React.CSSProperties}>
      <div className="game-timing__pos">
        <span className="game-timing__p">P{position}</span>
        <span className="game-timing__of">of {fieldSize}</span>
      </div>
      <div className="game-timing__lap">
        <span className={`game-timing__lapnum${finalLap ? ' is-final' : ''}`}>{Math.max(1, Math.min(lap + 1, laps))}<em>/{laps}</em></span>
        <span className="game-timing__label">{finalLap ? 'Final lap' : 'Lap'}</span>
      </div>
      <dl className="game-timing__times">
        <div><dt>Current</dt><dd>{formatLapTime(lap >= 0 && phase === 'racing' ? elapsed - currentLapStart : null)}</dd></div>
        <div><dt>Best</dt><dd>{formatLapTime(bestLap)}</dd></div>
        <div><dt>Ahead</dt><dd>{gapAhead === null ? 'Leader' : `+${gapAhead.toFixed(1)}s`}</dd></div>
        <div><dt>Behind</dt><dd>{gapBehind === null ? '—' : `-${gapBehind.toFixed(1)}s`}</dd></div>
      </dl>
    </div>
  );
}

/** Short-lived event feedback: passes, lap times, DRS, track limits. */
function Toasts() {
  const events = useGameStore((state) => state.events);
  const elapsed = useGameStore((state) => state.elapsed);
  const phase = useGameStore((state) => state.phase);
  const live = phase === 'finished' ? [] : events.filter((event) => elapsed - event.at < EVENT_TTL_SECONDS).slice(-3);
  return (
    <ul className="game-toasts" aria-live="polite">
      {live.map((event) => <Toast key={event.id} event={event} />)}
    </ul>
  );
}

function Toast({ event }: { event: GameEvent }) {
  return <li className={`game-toast game-toast--${event.kind}`}>{event.text}</li>;
}

/** Full-width moments: lights out, final lap, the flag. */
function Banners() {
  const finalLap = useGameStore((state) => state.finalLap);
  const phase = useGameStore((state) => state.phase);
  const elapsed = useGameStore((state) => state.elapsed);
  const currentLapStart = useGameStore((state) => state.currentLapStart);
  const finishPosition = useGameStore((state) => state.finishPosition);
  const showFinal = finalLap && elapsed - currentLapStart < 3;
  if (phase === 'finished') {
    return <div className="game-banner game-banner--flag" role="status"><span className="game-banner__flag" aria-hidden="true" />Chequered flag · P{finishPosition}</div>;
  }
  if (showFinal) return <div className="game-banner" role="status">Final lap</div>;
  return null;
}

/**
 * Every car on the circuit, updated straight from the store each frame; the
 * player's dot is larger and in team colour, DRS zones are drawn in the accent.
 */
function MiniMap() {
  const ids = useGameStore((state) => state.ai.map((car) => car.driverId).join(','));
  const driverId = useGameStore((state) => state.driverId);
  const team = teamOfDriver(driverId);
  const dots = useRef<Map<string, SVGCircleElement>>(new Map());
  const player = useRef<SVGCircleElement>(null);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const state = gameStore.getState();
      for (const car of state.ai) {
        const dot = dots.current.get(car.driverId);
        if (!dot) continue;
        const { x, y } = mapPoint(car.distance, car.lateralOffset);
        dot.setAttribute('cx', x.toFixed(2));
        dot.setAttribute('cy', y.toFixed(2));
        dot.style.opacity = car.status === 'retired' ? '0' : '1';
      }
      if (player.current) {
        const { x, y } = mapPoint(state.fraction, state.lateral);
        player.current.setAttribute('cx', x.toFixed(2));
        player.current.setAttribute('cy', y.toFixed(2));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <svg className="minimap" viewBox="0 0 100 100" aria-label="Circuit map with car positions" style={{ '--team': team.color } as React.CSSProperties}>
      <path d={MINIMAP_OUTLINE} className="minimap__track" />
      {MINIMAP_PASSING_ZONES.map((d) => <path key={d} d={d} className="minimap__drs" />)}
      <line {...MINIMAP_START} className="minimap__start" />
      {ids.split(',').filter(Boolean).map((id) => {
        const driver = DRIVERS_2026.find((candidate) => candidate.id === id);
        const rivalTeam = TEAMS_2026.find((candidate) => candidate.id === driver?.teamId);
        return (
          <circle
            key={id}
            r="1.6"
            className="minimap__car"
            style={{ fill: rivalTeam?.color ?? '#fff' }}
            ref={(node) => { if (node) dots.current.set(id, node); else dots.current.delete(id); }}
          />
        );
      })}
      <circle ref={player} r="2.6" className="minimap__player" />
    </svg>
  );
}

/** Gear inside a 270° RPM arc, speed beneath, DRS chip alongside. */
function Wheel() {
  const speed = useGameStore((state) => state.car.speed);
  const gear = useGameStore((state) => state.gear);
  const rpm = useGameStore((state) => state.rpm);
  const drsAvailable = useGameStore((state) => state.drsAvailable);
  const drsActive = useGameStore((state) => state.drsActive);
  const kph = Math.round(Math.abs(speed) * 3.6);
  // Arc from 135° to 405° (270° sweep), radius 44 in a 100-unit box.
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const sweep = circumference * 0.75;
  const fill = sweep * Math.max(0, Math.min(1, rpm));
  const redline = rpm > 0.94;
  return (
    <div className="game-wheel">
      <div className={`game-wheel__drs${drsActive ? ' is-active' : drsAvailable ? ' is-available' : ''}`} aria-label={drsActive ? 'DRS open' : drsAvailable ? 'DRS available, hold Shift' : 'DRS closed'}>
        DRS
      </div>
      <div className="game-wheel__gauge" role="img" aria-label={`Gear ${gear}, ${kph} km/h`}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="game-wheel__track" cx="50" cy="50" r={radius} strokeDasharray={`${sweep} ${circumference}`} />
          <circle className={`game-wheel__fill${redline ? ' is-redline' : ''}`} cx="50" cy="50" r={radius} strokeDasharray={`${fill} ${circumference}`} />
        </svg>
        <span className={`game-wheel__gear${redline ? ' is-redline' : ''}`}>{gear}</span>
        <span className="game-wheel__speed">{kph}<em>km/h</em></span>
      </div>
    </div>
  );
}

function OffTrack() {
  const onTrack = useGameStore((state) => state.onTrack);
  const phase = useGameStore((state) => state.phase);
  if (onTrack || phase !== 'racing') return null;
  return <div className="game-hud__warn" role="status">Off track · press R to reset</div>;
}

function Keys() {
  const [hidden, setHidden] = useState(false);
  const elapsed = useGameStore((state) => state.elapsed);
  // The legend is for the first minute; after that it is furniture.
  useEffect(() => { if (elapsed > 45) setHidden(true); }, [elapsed]);
  if (hidden) return null;
  return (
    <div className="game-hud__keys" aria-hidden="true">
      <span><b>W</b> throttle</span><span><b>S</b> brake</span><span><b>A</b>/<b>D</b> steer</span><span><b>Shift</b> DRS</span><span><b>R</b> reset</span>
    </div>
  );
}
