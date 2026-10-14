import { useEffect, useMemo, useRef, useState } from 'react';
import { SHANGHAI_TRACK } from '../track/shanghai-track';
import { buildLapModel } from './circuit-lap';

/** One loop of the dot, whatever the modelled lap time: quick enough to read as a lap. */
const LOOP_SECONDS = 7;
const SECTOR_COLOURS = ['#b26bff', '#3dff7a', '#ffd60a'] as const;

const LAP = buildLapModel(SHANGHAI_TRACK);

export interface CircuitTeaserProps {
  /** The running dot's colour, from the livery. */
  colour: string;
  circuitName: string;
  laps: number;
  /** Called once the lights go out. */
  onStart(): void;
}

/**
 * The race button, drawn as the circuit: a dot laps it at the modelled pace,
 * slowing into the corners, while the sector chips light purple, green and
 * yellow as it passes through them. Pressing it runs the start lights, five
 * reds then lights out, and the race begins; pressing again aborts.
 */
export function CircuitTeaser({ colour, circuitName, laps, onStart }: CircuitTeaserProps) {
  const dot = useRef<SVGCircleElement>(null);
  const chips = useRef<(HTMLElement | null)[]>([]);
  const sectors = useRef<(SVGPathElement | null)[]>([]);
  const [lights, setLights] = useState<number | null>(null);
  const timers = useRef<number[]>([]);
  const fast = useRef(false);

  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);

  useEffect(() => {
    let frame = 0;
    let phase = 0;
    let last = performance.now();
    let shown = -1;
    const tick = (now: number) => {
      const delta = Math.min(0.1, (now - last) / 1000);
      last = now;
      phase = (phase + (delta / LOOP_SECONDS) * (fast.current ? 2.2 : 1)) % 1;
      const point = LAP.at(phase);
      dot.current?.setAttribute('cx', point.x.toFixed(2));
      dot.current?.setAttribute('cy', point.y.toFixed(2));
      const sector = phase < LAP.sectorEnds[0] ? 0 : phase < LAP.sectorEnds[1] ? 1 : 2;
      if (sector !== shown) {
        shown = sector;
        chips.current.forEach((chip, index) => chip?.classList.toggle('is-on', index === sector));
        sectors.current.forEach((path, index) => path?.classList.toggle('is-on', index === sector));
      }
      frame = requestAnimationFrame(tick);
    };
    if (reduced) {
      const point = LAP.at(0);
      dot.current?.setAttribute('cx', point.x.toFixed(2));
      dot.current?.setAttribute('cy', point.y.toFixed(2));
      return undefined;
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  const clearTimers = () => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const press = () => {
    if (lights !== null) {
      clearTimers();
      setLights(null);
      return;
    }
    if (reduced) { onStart(); return; }
    setLights(0);
    for (let light = 1; light <= 5; light += 1) {
      timers.current.push(window.setTimeout(() => setLights(light), light * 520));
    }
    // A random hold, as at a real start, then lights out.
    const hold = 5 * 520 + 400 + Math.random() * 900;
    timers.current.push(window.setTimeout(() => setLights(6), hold));
    timers.current.push(window.setTimeout(() => { setLights(null); onStart(); }, hold + 380));
  };

  const running = lights !== null;
  const label = running ? 'Abort the start' : `Race at ${circuitName}: press for the start lights`;

  return (
    <button
      type="button"
      className={running ? 'teaser is-lights' : 'teaser'}
      style={{ '--tcol': colour } as React.CSSProperties}
      onClick={press}
      onPointerEnter={() => { fast.current = true; }}
      onPointerLeave={() => { fast.current = false; }}
      aria-label={label}
    >
      <svg className="teaser__trk" viewBox="0 0 100 64" aria-hidden="true">
        <path className="teaser__rail" d={LAP.path} />
        {LAP.sectorPaths.map((d, index) => (
          <path key={index} ref={(node) => { sectors.current[index] = node; }} className="teaser__sector" d={d} style={{ '--sc': SECTOR_COLOURS[index] } as React.CSSProperties} />
        ))}
        <line className="teaser__sf" {...LAP.startTick} />
        <circle ref={dot} className="teaser__dot" r="2.6" />
      </svg>
      <span className="teaser__tx">
        <span className="teaser__t1">
          <b>Race</b>
          <i><span className="teaser__lg">{circuitName}</span><span className="teaser__sh">{laps} laps</span></i>
        </span>
        <small>{running ? (lights === 6 ? 'Lights out!' : 'Press again to abort') : `Your car, the grid, ${laps} laps`}</small>
        <span className="teaser__secs" aria-hidden="true">
          {['S1', 'S2', 'S3'].map((name, index) => (
            <em key={name} ref={(node) => { chips.current[index] = node; }} style={{ '--sc': SECTOR_COLOURS[index] } as React.CSSProperties}>{name}</em>
          ))}
        </span>
        <span className="teaser__lights" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((light) => <span key={light} className={lights !== 6 && (lights ?? 0) >= light ? 'is-lit' : undefined} />)}
        </span>
      </span>
    </button>
  );
}

export const SHANGHAI_LAP = LAP;
