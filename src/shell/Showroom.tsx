import { useProgress } from '@react-three/drei';
import { useEffect, useRef, useState } from 'react';
import { CALENDAR_2026 } from '../content/calendar-2026';
import { findCircuit } from '../content/circuits';
import { findProfile } from '../content/driver-profiles';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import { gameStore, type Difficulty, type FieldSize } from '../game/game-store';
import { useCoarsePointer } from '../game/TouchControls';
import { AppNav } from './AppNav';
import { CircuitMap } from './CircuitMap';
import { ShowroomScene, preloadShowroom } from './ShowroomScene';

const CAR_NAMES: Record<string, string> = {
  'red-bull': 'RB21', ferrari: 'SF-25', mclaren: 'MCL39', 'aston-martin': 'AMR25',
  alpine: 'A525', williams: 'FW47', 'racing-bulls': 'VCARB01',
};

/** The one circuit with a driving surface today. Others are on the calendar as coming. */
const DRIVABLE = new Set(['shanghai']);

const PACE_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Real F1' };

function teamOf(teamId: string) {
  return TEAMS_2026.find((team) => team.id === teamId) ?? TEAMS_2026[0];
}

/**
 * The front door, built as a game menu rather than a website: the car in
 * 3D, the field to flip through, the circuit, the race settings, and one big
 * button. The browse pages are still a tap away in the top bar.
 */
export function Showroom() {
  const [index, setIndex] = useState(0);
  // Which way the last flip went (for the sweep) and how many flips there have been (to retrigger it).
  const [direction, setDirection] = useState(1);
  const [serial, setSerial] = useState(0);
  const [circuitId, setCircuitId] = useState('shanghai');
  const [pickingCircuit, setPickingCircuit] = useState(false);
  const [laps, setLaps] = useState(5);
  // Phones default to a lighter field; they can dial it up.
  const [fieldSize, setFieldSize] = useState<FieldSize>(() => (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 6 : 14));
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');

  const driver = DRIVERS_2026[index];
  const team = teamOf(driver.teamId);
  const profile = findProfile(driver.id);
  const circuit = findCircuit(circuitId) ?? findCircuit('shanghai')!;

  const touch = useCoarsePointer();
  const loading = useProgress((state) => state.active);
  const chips = useRef<HTMLDivElement>(null);

  useEffect(() => { preloadShowroom(); }, []);

  // Keep the chosen chip in view as you flip through the field.
  useEffect(() => {
    const chip = chips.current?.querySelector<HTMLElement>('.showroom__chip.is-selected');
    chip?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [index]);

  const choose = (next: number, towards: number) => {
    setDirection(towards);
    setSerial((current) => current + 1);
    setIndex(next);
  };
  const move = (delta: number) => choose((index + delta + DRIVERS_2026.length) % DRIVERS_2026.length, Math.sign(delta) || 1);

  const start = () => {
    gameStore.getState().configure({ driverId: driver.id, laps, difficulty, fieldSize });
    gameStore.getState().start();
    window.location.hash = '#/play/race';
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') { event.preventDefault(); move(-1); }
      if (event.code === 'ArrowRight' || event.code === 'KeyD') { event.preventDefault(); move(1); }
      if (event.code === 'Enter' && !pickingCircuit) start();
      if (event.code === 'Escape') setPickingCircuit(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const ratings = [
    ['Pace', driver.ratings.pace],
    ['Qualifying', driver.ratings.qualifying],
    ['Overtaking', driver.ratings.overtaking],
    ['Defending', driver.ratings.defending],
  ] as const;

  return (
    <div className="showroom" style={{ '--team': team.color, '--accent': team.accent } as React.CSSProperties}>
      <AppNav active="home" />

      <div className="showroom__stage" aria-hidden="true">
        <ShowroomScene teamId={team.id} direction={direction} serial={serial} lite={touch} />
        {loading && (
          <div className="showroom__loading">
            <span className="showroom__loading-bar" />
            <span>Loading {CAR_NAMES[team.id]}</span>
          </div>
        )}
      </div>

      <section className="showroom__driver" aria-label="Your car">
        <div key={driver.id} className={`showroom__card${direction > 0 ? ' is-from-right' : ' is-from-left'}`}>
          <p className="showroom__eyebrow">{team.name} · {CAR_NAMES[team.id]}</p>
          <div className="showroom__number" aria-hidden="true">{driver.number}</div>
          <h1 className="showroom__name">{driver.name}</h1>
          <p className="showroom__hook">{profile?.hook}</p>
          <dl className="showroom__ratings">
            {ratings.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd><span className="showroom__meter"><i style={{ width: `${Math.round(value * 100)}%` }} /></span><em>{Math.round(value * 100)}</em></dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="showroom__race" aria-label="Race">
        <button type="button" className="showroom__circuit" onClick={() => setPickingCircuit(true)} aria-haspopup="dialog">
          <span className="showroom__circuit-map"><CircuitMap circuit={circuit} /></span>
          <span className="showroom__circuit-text">
            <span className="showroom__eyebrow showroom__eyebrow--clip">R{circuit.round} · {circuit.grandPrix}</span>
            <strong>{circuit.name}</strong>
            <span className="showroom__circuit-meta">{circuit.lengthKm.toFixed(3)} km · {circuit.turns} turns · {circuit.drsZones ?? 0} DRS</span>
            <span className="showroom__change">Change circuit ↗</span>
          </span>
        </button>

        <div className="showroom__settings">
          <Segmented<number> label="Laps" value={laps} options={[3, 5, 8, 10]} onChange={setLaps} />
          <Segmented<FieldSize> label="Cars" value={fieldSize} options={[6, 10, 14]} onChange={setFieldSize} />
          <Segmented<Difficulty> label="AI pace" value={difficulty} options={['easy', 'medium', 'hard']} format={(value) => PACE_LABEL[value]} onChange={setDifficulty} />
        </div>
      </section>

      <footer className="showroom__foot">
        <div className="showroom__field" role="radiogroup" aria-label="Choose your driver">
          <button type="button" className="showroom__arrow" onClick={() => move(-1)} aria-label="Previous driver">‹</button>
          <div className="showroom__chips" ref={chips}>
            {DRIVERS_2026.map((candidate, candidateIndex) => {
              const candidateTeam = teamOf(candidate.teamId);
              const selected = candidateIndex === index;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={selected ? 'showroom__chip is-selected' : 'showroom__chip'}
                  style={{ '--chip': candidateTeam.color } as React.CSSProperties}
                  onClick={() => choose(candidateIndex, candidateIndex >= index ? 1 : -1)}
                >
                  <span className="showroom__chip-num">{candidate.number}</span>
                  <span className="showroom__chip-name">{candidate.abbreviation}</span>
                </button>
              );
            })}
          </div>
          <button type="button" className="showroom__arrow" onClick={() => move(1)} aria-label="Next driver">›</button>
        </div>
        <button type="button" className="showroom__start" onClick={start}>Start race</button>
      </footer>

      {pickingCircuit && (
        <div className="showroom__picker" role="dialog" aria-modal="true" aria-label="Choose a circuit">
          <div className="showroom__picker-sheet">
            <header>
              <p className="showroom__eyebrow">2026 calendar</p>
              <h2>Choose a circuit</h2>
              <button type="button" className="shell-btn" onClick={() => setPickingCircuit(false)}>Close</button>
            </header>
            <ol className="showroom__rounds">
              {CALENDAR_2026.map((round) => {
                const drivable = DRIVABLE.has(round.id);
                const entry = findCircuit(round.id);
                return (
                  <li key={round.id}>
                    <button
                      type="button"
                      className={`showroom__round${drivable ? '' : ' is-locked'}${round.id === circuitId ? ' is-selected' : ''}`}
                      disabled={!drivable}
                      onClick={() => { setCircuitId(round.id); setPickingCircuit(false); }}
                    >
                      <span className="showroom__round-map">{entry?.outline ? <CircuitMap circuit={entry} /> : <span className="showroom__round-blank" />}</span>
                      <span className="showroom__round-text">
                        <span className="showroom__round-num">R{round.round}</span>
                        <strong>{round.circuit}</strong>
                        <span>{round.name}</span>
                      </span>
                      <span className="showroom__round-tag">{drivable ? 'Drive' : 'Soon'}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string | number>({ label, value, options, onChange, format }: {
  label: string;
  value: T;
  options: readonly T[];
  onChange(value: T): void;
  format?(value: T): string;
}) {
  return (
    <div className="showroom__segment" role="radiogroup" aria-label={label}>
      <span className="showroom__segment-label">{label}</span>
      <div className="showroom__segment-options">
        {options.map((option) => (
          <button
            key={String(option)}
            type="button"
            role="radio"
            aria-checked={option === value}
            className={option === value ? 'is-selected' : undefined}
            onClick={() => onChange(option)}
          >
            {format ? format(option) : String(option)}
          </button>
        ))}
      </div>
    </div>
  );
}
