import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { findCircuit } from '../content/circuits';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import { SHANGHAI_TRACK } from '../track/shanghai-track';
import { WideNumber, wideDigits } from '../ui/WideNumber';
import {
  ASSISTS,
  formatLapTime,
  gameStore,
  projectedTrack,
  rivalSpeedMps,
  teamOfDriver,
  useGameStore,
  useGameStoreSampled,
  type GameEvent,
  type GameState,
} from './game-store';
import { MINIMAP_OUTLINE, MINIMAP_PASSING_ZONES, MINIMAP_SECTORS, MINIMAP_START, mapPoint } from './minimap';

const CAR_NAMES: Record<string, string> = {
  'red-bull': 'RB21', ferrari: 'SF-25', mclaren: 'MCL39', 'aston-martin': 'AMR25',
  alpine: 'A525', williams: 'FW47', 'racing-bulls': 'VCARB01',
};

/**
 * The race HUD, in the garage's language: glass cards, pill segments, team
 * colour, the wide display face for the numbers that matter and MonoSpec for
 * every figure that changes.
 *
 * Top left, the race card: position, lap, the lap clock with a live delta to
 * your best lap, sectors and the gaps to the cars either side. Top right, the
 * running order. Bottom left, the circuit with every car on it. Bottom right,
 * the dash: shift lights, gear, speed, pedals and DRS. Race control messages
 * appear top centre; the controls sit bottom centre until you know them.
 */
export function GameHud() {
  const phase = useGameStore((state) => state.phase);
  const driverId = useGameStore((state) => state.driverId);
  const team = teamOfDriver(driverId);
  const style = { '--team': team.color, '--accent': team.accent } as CSSProperties;
  return (
    <div className="game-hud rh" style={style} aria-live="off">
      {phase === 'intro' && <IntroCard />}
      {(phase === 'lights' || phase === 'racing') && <StartLights />}
      {phase !== 'intro' && (
        <>
          <RaceCard />
          <Tower />
          <TrackMap />
          <Dash />
          <Feed />
          <OffTrack />
          <Keys />
        </>
      )}
    </div>
  );
}

const SECTOR_ENDS = SHANGHAI_TRACK.sectors;

function driverOf(id: string) {
  return DRIVERS_2026.find((driver) => driver.id === id);
}

function teamColour(driverId: string): string {
  const driver = driverOf(driverId);
  return TEAMS_2026.find((team) => team.id === driver?.teamId)?.color ?? '#fff';
}

/* ------------------------------------------------------------------ intro -- */

/** Title cards over the flyover: the round, then who you are driving. */
/**
 * Shrinks an element's text until it fits its box, for display names whose
 * longest word can be wider than the screen allows. Refits when its card
 * changes size and once the display face has loaded.
 */
function useFitText<T extends HTMLElement>(text: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const fit = () => {
      element.style.fontSize = '';
      const overflow = element.scrollWidth / Math.max(1, element.clientWidth);
      if (overflow > 1.005) element.style.fontSize = `${parseFloat(getComputedStyle(element).fontSize) / overflow}px`;
    };
    fit();
    let live = true;
    document.fonts?.ready.then(() => { if (live) fit(); });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(element.parentElement ?? element);
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [text]);
  return ref;
}

function IntroCard() {
  const driverId = useGameStore((state) => state.driverId);
  const laps = useGameStore((state) => state.laps);
  const introSeconds = useGameStoreSampled((state) => state.introSeconds, 10);
  const fieldSize = useGameStore((state) => state.fieldSize);
  const circuit = findCircuit('shanghai')!;
  const driver = driverOf(driverId) ?? DRIVERS_2026[0];
  const team = teamOfDriver(driverId);
  const showDriver = introSeconds > 6.5;
  // First names over surnames, so the card stays compact.
  const words = driver.name.split(' ');
  const surname = words.length > 1 ? words.pop()! : '';
  const nameRef = useFitText<HTMLHeadingElement>(showDriver ? driver.name : '');
  return (
    <div className="rh-intro">
      {!showDriver ? (
        <div className="rh-intro__card" key="race">
          <p className="rh-eyebrow">Round {circuit.round} · {circuit.grandPrix}</p>
          <h2 className="rh-intro__title">Shanghai</h2>
          <dl className="rh-intro__facts">
            <div><dt>Length</dt><dd>{circuit.lengthKm.toFixed(3)} km</dd></div>
            <div><dt>Turns</dt><dd>{circuit.turns}</dd></div>
            <div><dt>Laps</dt><dd>{laps}</dd></div>
            <div><dt>DRS</dt><dd>{circuit.drsZones} zones</dd></div>
          </dl>
          <svg className="rh-intro__map" viewBox="0 0 100 100" aria-hidden="true">
            <path d={MINIMAP_OUTLINE} className="rh-map__halo" />
            <path d={MINIMAP_OUTLINE} className="rh-map__track" />
            {MINIMAP_PASSING_ZONES.map((d) => <path key={d} d={d} className="rh-map__drs" />)}
          </svg>
        </div>
      ) : (
        <div className="rh-intro__card rh-intro__card--driver" key="driver">
          <p className="rh-eyebrow">{team.name} · {CAR_NAMES[team.id]}</p>
          <div className="rh-intro__driver">
            <span className="rh-intro__num"><WideNumber value={driver.number} /></span>
            <h2 className="rh-intro__title rh-intro__title--name" ref={nameRef}>
              <span>{words.join(' ')}</span>{surname && <> <span>{surname}</span></>}
            </h2>
          </div>
          <dl className="rh-intro__facts">
            <div><dt>Grid</dt><dd>P{fieldSize}</dd></div>
            <div><dt>Start</dt><dd>Back row</dd></div>
          </dl>
        </div>
      )}
      <button type="button" className="rh-intro__skip" onClick={() => gameStore.getState().skipIntro()}>
        Skip <kbd>Enter</kbd>
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- lights -- */

/** Five columns of lights, one a second; they flash green as they go out. */
function StartLights() {
  const lights = useGameStore((state) => state.lights);
  const phase = useGameStore((state) => state.phase);
  const elapsed = useGameStoreSampled((state) => state.elapsed, 10);
  const visible = phase === 'lights' || (phase === 'racing' && elapsed < 1.6);
  if (!visible) return null;
  const out = phase === 'racing';
  return (
    <div className={`rh-lights${out ? ' is-out' : ''}`} role="status" aria-live="assertive" aria-label={out ? 'Lights out, go' : `${lights} of 5 lights`}>
      <div className="rh-lights__gantry" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((column) => (
          <div key={column} className={`rh-lights__column${!out && column < lights ? ' is-lit' : ''}`}><i /><i /></div>
        ))}
      </div>
      <p className="rh-lights__label">{out ? 'Lights out' : phase === 'lights' && lights === 5 ? 'Hold' : 'Start'}</p>
    </div>
  );
}

/* ------------------------------------------------------------- lap trace -- */

interface Sector {
  time: number | null;
  state: 'none' | 'pb' | 'slow' | 'live';
}

interface TraceView {
  lapTime: number | null;
  delta: number | null;
  sectors: Sector[];
  lastLap: number | null;
}

const BUCKETS = 400;

/**
 * Follows the player's lap: when each sector is crossed, and how long it took
 * to reach each 0.25% of the lap, so the current lap can be compared with the
 * best one point by point (the live delta).
 */
function useLapTrace(): TraceView {
  const [view, setView] = useState<TraceView>({ lapTime: null, delta: null, sectors: SECTOR_ENDS.map(() => ({ time: null, state: 'none' })), lastLap: null });
  useEffect(() => {
    let lap = gameStore.getState().lap;
    let current = new Float32Array(BUCKETS).fill(Number.NaN);
    let best: Float32Array | null = null;
    let bestTime = Number.POSITIVE_INFINITY;
    const bestSectors = SECTOR_ENDS.map(() => Number.POSITIVE_INFINITY);
    let sectorTimes: (number | null)[] = SECTOR_ENDS.map(() => null);
    let sectorStates: Sector['state'][] = SECTOR_ENDS.map(() => 'none');
    let sectorStart = 0;
    let previousFraction = gameStore.getState().fraction;
    let frame = 0;
    let lastPush = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const state = gameStore.getState();
      if (state.phase !== 'racing' && state.phase !== 'finished') return;
      const lapTime = state.lap >= 0 ? state.elapsed - state.currentLapStart : null;
      if (state.lap !== lap) {
        // A lap completed: sector three closes, and the lap becomes the reference if it is the best.
        const completed = state.lapTimes[state.lapTimes.length - 1];
        if (lap >= 0 && completed) {
          const s3 = completed.seconds - ((sectorTimes[0] ?? 0) + (sectorTimes[1] ?? 0));
          sectorTimes[2] = s3;
          sectorStates[2] = s3 < bestSectors[2] ? 'pb' : 'slow';
          bestSectors[2] = Math.min(bestSectors[2], s3);
          if (completed.seconds < bestTime) { bestTime = completed.seconds; best = current; }
        }
        lap = state.lap;
        current = new Float32Array(BUCKETS).fill(Number.NaN);
        sectorStart = state.currentLapStart;
        // Keep last lap's sectors on show until the first new one is set.
        sectorStates = sectorStates.map((value) => (value === 'none' ? 'none' : value));
      }
      if (lapTime !== null) {
        const bucket = Math.min(BUCKETS - 1, Math.floor(state.fraction * BUCKETS));
        if (Number.isNaN(current[bucket])) current[bucket] = lapTime;
        // Sector boundaries one and two.
        for (let k = 0; k < SECTOR_ENDS.length - 1; k += 1) {
          const end = SECTOR_ENDS[k];
          if (previousFraction < end && state.fraction >= end && state.fraction - previousFraction < 0.2) {
            const time = state.elapsed - sectorStart;
            sectorStart = state.elapsed;
            if (k === 0) { sectorTimes = SECTOR_ENDS.map(() => null); sectorStates = SECTOR_ENDS.map(() => 'none'); }
            sectorTimes[k] = time;
            sectorStates[k] = time < bestSectors[k] ? 'pb' : 'slow';
            bestSectors[k] = Math.min(bestSectors[k], time);
          }
        }
      }
      previousFraction = state.fraction;
      if (now - lastPush < 80) return;
      lastPush = now;
      let delta: number | null = null;
      if (best && lapTime !== null) {
        const bucket = Math.min(BUCKETS - 1, Math.floor(state.fraction * BUCKETS));
        const reference = best[bucket];
        if (!Number.isNaN(reference) && state.fraction > 0.01) delta = lapTime - reference;
      }
      const sectorIndex = SECTOR_ENDS.findIndex((end) => state.fraction < end);
      setView({
        lapTime,
        delta,
        lastLap: state.lapTimes.length ? state.lapTimes[state.lapTimes.length - 1].seconds : null,
        sectors: SECTOR_ENDS.map((_, k) => ({
          time: sectorTimes[k],
          state: sectorTimes[k] === null && k === sectorIndex && lapTime !== null ? 'live' : sectorStates[k],
        })),
      });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return view;
}

/* -------------------------------------------------------- running order -- */

interface OrderRow {
  driverId: string;
  isPlayer: boolean;
  /** Seconds to the car ahead, or null for the leader. */
  interval: number | null;
  finished: boolean;
}

function runningOrder(state: GameState): OrderRow[] {
  const length = projectedTrack.lengthMeters;
  const entries = state.ai
    .filter((car) => car.status !== 'retired')
    .map((car) => ({
      driverId: car.driverId, isPlayer: false, progress: car.status === 'finished' ? state.laps + 1 : car.lap + car.distance,
      speed: rivalSpeedMps(car, state.difficulty), finished: car.status === 'finished',
    }));
  entries.push({
    driverId: state.driverId, isPlayer: true, progress: state.phase === 'finished' ? state.laps + 0.5 : state.lap + state.fraction,
    speed: state.car.speed, finished: state.phase === 'finished',
  });
  entries.sort((a, b) => b.progress - a.progress);
  return entries.map((entry, index) => {
    if (index === 0) return { driverId: entry.driverId, isPlayer: entry.isPlayer, interval: null, finished: entry.finished };
    const ahead = entries[index - 1];
    const metres = (ahead.progress - entry.progress) * length;
    return { driverId: entry.driverId, isPlayer: entry.isPlayer, interval: metres / Math.max(28, entry.speed), finished: entry.finished };
  });
}

function useRunningOrder(): OrderRow[] {
  const [order, setOrder] = useState<OrderRow[]>(() => runningOrder(gameStore.getState()));
  useEffect(() => {
    const interval = window.setInterval(() => setOrder(runningOrder(gameStore.getState())), 250);
    return () => window.clearInterval(interval);
  }, []);
  return order;
}

function formatInterval(seconds: number | null): string {
  if (seconds === null) return 'Leader';
  if (seconds > 60) return '+1 lap';
  return `+${seconds.toFixed(1)}`;
}

/* -------------------------------------------------------------- race card -- */

function RaceCard() {
  const position = useGameStore((state) => state.position);
  const fieldSize = useGameStore((state) => state.fieldSize);
  const lap = useGameStore((state) => state.lap);
  const laps = useGameStore((state) => state.laps);
  const bestLap = useGameStore((state) => state.bestLap);
  const finalLap = useGameStore((state) => state.finalLap);
  const fraction = useGameStoreSampled((state) => state.fraction, 8);
  const trace = useLapTrace();
  const order = useRunningOrder();
  const me = order.findIndex((row) => row.isPlayer);
  const ahead = me > 0 ? order[me - 1] : null;
  const behind = me >= 0 && me < order.length - 1 ? order[me + 1] : null;
  const shownLap = Math.max(1, Math.min(lap + 1, laps));
  return (
    <section className="rh-card rh-race" aria-label="Race position and timing">
      <div className="rh-race__head">
        <div className="rh-race__pos" aria-label={`Position ${position} of ${fieldSize}`}>
          <span className="rh-race__p">P</span>
          <strong className="rh-race__pnum"><WideNumber value={position} /></strong>
          <span className="rh-race__of">/{fieldSize}</span>
        </div>
        <div className="rh-race__lap">
          <div className="rh-race__lapline">
            <span className="rh-label">{finalLap ? 'Final lap' : 'Lap'}</span>
            <strong className={finalLap ? 'is-final' : ''}><WideNumber value={shownLap} /><em><WideNumber value={`/${laps}`} /></em></strong>
          </div>
          <div className="rh-race__laps" aria-hidden="true">
            {Array.from({ length: laps }, (_, index) => (
              <i key={index} style={{ '--fill': `${index < lap ? 100 : index === lap ? Math.round(fraction * 100) : 0}%` } as CSSProperties} />
            ))}
          </div>
        </div>
      </div>
      <div className="rh-race__clock">
        <div>
          <span className="rh-label">Current</span>
          <strong className="rh-figure rh-figure--big">{formatLapTime(trace.lapTime)}</strong>
        </div>
        {trace.delta !== null && (
          <span className={`rh-delta${trace.delta <= 0 ? ' is-up' : ' is-down'}`}>{trace.delta <= 0 ? '−' : '+'}{Math.abs(trace.delta).toFixed(3)}</span>
        )}
      </div>
      <ol className="rh-sectors" aria-label="Sectors">
        {trace.sectors.map((sector, index) => (
          <li key={index} className={`is-${sector.state}`}>
            <span>S{index + 1}</span>
            <b>{sector.time === null ? '—' : sector.time.toFixed(3)}</b>
          </li>
        ))}
      </ol>
      <dl className="rh-race__times">
        <div><dt>Best</dt><dd className={bestLap !== null ? 'is-pb' : ''}>{formatLapTime(bestLap)}</dd></div>
        <div><dt>Last</dt><dd>{formatLapTime(trace.lastLap)}</dd></div>
      </dl>
      <div className="rh-gaps">
        <Gap label="Ahead" row={ahead} sign="+" interval={order[me]?.interval ?? null} />
        <Gap label="Behind" row={behind} sign="−" interval={behind?.interval ?? null} />
      </div>
    </section>
  );
}

function Gap({ label, row, sign, interval }: { label: string; row: OrderRow | null; sign: string; interval: number | null }) {
  const driver = row ? driverOf(row.driverId) : null;
  return (
    <div className="rh-gap" style={{ '--car': row ? teamColour(row.driverId) : 'transparent' } as CSSProperties}>
      <span className="rh-label">{label}</span>
      {driver ? (
        <>
          <b className="rh-gap__code">{driver.abbreviation}</b>
          <span className="rh-figure">{interval === null ? '—' : `${sign}${Math.min(interval, 99).toFixed(1)}s`}</span>
        </>
      ) : <b className="rh-gap__code rh-gap__code--none">{label === 'Ahead' ? 'Leader' : 'Last'}</b>}
    </div>
  );
}

/* ------------------------------------------------------------------ tower -- */

function Tower() {
  const order = useRunningOrder();
  const lap = useGameStore((state) => state.lap);
  const laps = useGameStore((state) => state.laps);
  return (
    <section className="rh-card rh-tower" aria-label="Running order">
      <header className="rh-tower__head">
        <span className="rh-label">Running order</span>
        <span className="rh-figure">L{Math.max(1, Math.min(lap + 1, laps))}/{laps}</span>
      </header>
      <ol className="rh-tower__list">
        {order.map((row, index) => {
          const driver = driverOf(row.driverId);
          return (
            <li key={row.driverId} className={row.isPlayer ? 'is-me' : ''} style={{ '--car': teamColour(row.driverId) } as CSSProperties}>
              <span className="rh-tower__pos">{index + 1}</span>
              <i className="rh-tower__bar" aria-hidden="true" />
              <b className="rh-tower__code">{driver?.abbreviation ?? '—'}</b>
              <span className="rh-tower__gap">{row.finished ? 'Fin' : formatInterval(row.interval)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* -------------------------------------------------------------- track map -- */

function TrackMap() {
  const ids = useGameStore((state) => state.ai.map((car) => car.driverId).join(','));
  const fraction = useGameStoreSampled((state) => state.fraction, 4);
  const sector = Math.max(0, SECTOR_ENDS.findIndex((end) => fraction < end));
  const dots = useRef<Map<string, SVGCircleElement>>(new Map());
  const player = useRef<SVGGElement>(null);

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
        player.current.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section className="rh-card rh-map" aria-label="Circuit map with car positions">
      <header className="rh-map__head">
        <span className="rh-label">Shanghai</span>
        <span className="rh-map__sector">Sector {sector + 1}</span>
      </header>
      <svg viewBox="0 0 100 100" className="rh-map__svg">
        <path d={MINIMAP_OUTLINE} className="rh-map__halo" />
        {MINIMAP_SECTORS.map((d, index) => <path key={d} d={d} className={`rh-map__sector-line${index === sector ? ' is-here' : ''}`} />)}
        {MINIMAP_PASSING_ZONES.map((d) => <path key={d} d={d} className="rh-map__drs" />)}
        <line {...MINIMAP_START} className="rh-map__start" />
        {ids.split(',').filter(Boolean).map((id) => (
          <circle
            key={id}
            r="1.9"
            className="rh-map__car"
            style={{ fill: teamColour(id) }}
            ref={(node) => { if (node) dots.current.set(id, node); else dots.current.delete(id); }}
          />
        ))}
        <g ref={player} className="rh-map__me">
          <circle r="4.6" className="rh-map__pulse" />
          <circle r="2.7" className="rh-map__player" />
        </g>
      </svg>
    </section>
  );
}

/* ------------------------------------------------------------------- dash -- */

const SHIFT_LIGHTS = 15;
const DIGITS = 3;

/** Speed in fixed-width digits, so the wide face never jitters as it changes. */
function Digits({ value }: { value: number }) {
  const text = String(Math.max(0, Math.min(999, value))).padStart(DIGITS, ' ');
  return (
    <span className="rh-digits" aria-hidden="true">
      {text.split('').map((char, index) => <i key={index} className={char === ' ' ? 'is-blank' : ''}>{wideDigits(char === ' ' ? '0' : char)}</i>)}
    </span>
  );
}

function Dash() {
  const speed = useGameStoreSampled((state) => Math.round(Math.abs(state.car.speed) * 3.6), 24);
  const gear = useGameStore((state) => state.gear);
  const rpm = useGameStoreSampled((state) => Math.round(state.rpm * 200) / 200, 30);
  const throttle = useGameStoreSampled((state) => Math.round(state.throttle * 20) / 20, 20);
  const brake = useGameStoreSampled((state) => Math.round(state.brake * 20) / 20, 20);
  const assisting = useGameStoreSampled((state) => state.assisting, 10);
  const drsAvailable = useGameStore((state) => state.drsAvailable);
  const drsActive = useGameStore((state) => state.drsActive);
  const difficulty = useGameStore((state) => state.difficulty);
  const phase = useGameStore((state) => state.phase);
  const assists = ASSISTS[difficulty];
  const lit = Math.max(0, Math.min(SHIFT_LIGHTS, Math.floor(((rpm - 0.55) / 0.41) * SHIFT_LIGHTS)));
  const flashing = rpm > 0.965 && phase === 'racing';
  return (
    <section className="rh-card rh-dash" aria-label={`Gear ${gear}, ${speed} kilometres per hour`}>
      <div className={`rh-shift${flashing ? ' is-flash' : ''}`} aria-hidden="true">
        {Array.from({ length: SHIFT_LIGHTS }, (_, index) => (
          <i key={index} className={`${index < lit ? 'is-on' : ''} ${index < 5 ? 'g' : index < 10 ? 'r' : 'b'}`} />
        ))}
      </div>
      <div className="rh-dash__main">
        <div className="rh-dash__gear">
          <span className="rh-label">Gear</span>
          <strong>{phase === 'lights' ? 'N' : gear}</strong>
        </div>
        <div className="rh-dash__speed">
          <Digits value={speed} />
          <span className="rh-label">km/h</span>
        </div>
        <div className="rh-pedals" aria-hidden="true">
          <div className="rh-pedal rh-pedal--brake"><i style={{ height: `${brake * 100}%` }} /></div>
          <div className="rh-pedal rh-pedal--throttle"><i style={{ height: `${throttle * 100}%` }} /></div>
        </div>
      </div>
      <div className="rh-dash__chips">
        <span className={`rh-chip rh-chip--drs${drsActive ? ' is-active' : drsAvailable ? ' is-available' : ''}`} aria-label={drsActive ? 'DRS open' : drsAvailable ? 'DRS available, hold Shift' : 'DRS closed'}>DRS</span>
        <span className={`rh-chip${assists.brake > 0 ? '' : ' is-off'}${assisting ? ' is-working' : ''}`} title="Braking assist">Brake aid</span>
        <span className={`rh-chip${assists.steer > 0 ? '' : ' is-off'}`} title="Steering assist">Line aid</span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- feed -- */

const FEED_SECONDS = 3.4;

/** Race control: the latest message, briefly, top centre. */
function Feed() {
  const events = useGameStore((state) => state.events);
  const [shown, setShown] = useState<GameEvent | null>(null);
  useEffect(() => {
    const latest = events[events.length - 1];
    if (!latest || latest.kind === 'flag') return;
    setShown(latest);
    const timer = window.setTimeout(() => setShown((current) => (current?.id === latest.id ? null : current)), FEED_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [events]);
  if (!shown) return null;
  return (
    <div className={`rh-feed is-${shown.kind}`} role="status" key={shown.id}>
      <i aria-hidden="true" />
      <span>{shown.text}</span>
    </div>
  );
}

function OffTrack() {
  const onTrack = useGameStore((state) => state.onTrack);
  const phase = useGameStore((state) => state.phase);
  const slow = useGameStoreSampled((state) => state.car.speed < 4, 4);
  if (onTrack || phase !== 'racing') return null;
  return (
    <div className="rh-warn" role="status">
      <strong>Off track</strong>
      <span>{slow ? 'Press R to rejoin' : 'Slow on the grass'}</span>
    </div>
  );
}

/* ------------------------------------------------------------------- keys -- */

const KEYS: { keys: string[]; label: string }[] = [
  { keys: ['W', '↑'], label: 'Throttle' },
  { keys: ['S', '↓'], label: 'Brake' },
  { keys: ['A', 'D'], label: 'Steer' },
  { keys: ['⇧'], label: 'DRS' },
  { keys: ['R'], label: 'Reset' },
  { keys: ['P'], label: 'Pause' },
];

/** The controls, open for the first laps; H shows or hides them any time. */
function Keys() {
  const [open, setOpen] = useState(true);
  const touched = useRef(false);
  const elapsed = useGameStoreSampled((state) => state.elapsed, 2);
  useEffect(() => {
    if (!touched.current && elapsed > 40) setOpen(false);
  }, [elapsed]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'KeyH' || event.repeat) return;
      touched.current = true;
      setOpen((value) => !value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className={`rh-keys${open ? '' : ' is-closed'}`} aria-hidden="true">
      {open && KEYS.map((entry) => (
        <span key={entry.label} className="rh-keys__item">
          {entry.keys.map((key) => <kbd key={key}>{key}</kbd>)}
          <em>{entry.label}</em>
        </span>
      ))}
      <span className="rh-keys__item rh-keys__toggle"><kbd>H</kbd><em>{open ? 'Hide' : 'Controls'}</em></span>
    </div>
  );
}
