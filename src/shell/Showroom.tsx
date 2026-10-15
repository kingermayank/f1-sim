import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { CALENDAR_2026 } from '../content/calendar-2026';
import { findCircuit } from '../content/circuits';
import { findProfile } from '../content/driver-profiles';
import { DRIVERS_2026, TEAMS_2026 } from '../domain/grid-2026';
import { gameStore, type Difficulty } from '../game/game-store';
import { useCoarsePointer } from '../game/TouchControls';
import { LIVERIES, liveryFor, FINISHES, type Livery } from '../car/liveries';
import { COMPOUNDS } from '../car/car-materials';
import { AppNav } from './AppNav';
import { CircuitMap } from './CircuitMap';
import { CircuitTeaser } from './CircuitTeaser';
import {
  canvasBlob, composePicture, decodeGarage, downloadBlob, encodeGarage, garageUrl, pictureFilename,
  type GarageState, type PictureInfo,
} from './garage-share';
import { readHashParams } from './router';
import { ShowroomScene, type FrameInset, type PictureAngle, type ShowroomCapture } from './ShowroomScene';
import { persistSelectedDriverId, readSelectedDriverId, teamThemeStyle } from './team-theme';
import { uiSound } from './ui-sound';
import { WideNumber, wideDigits } from '../ui/WideNumber';

const CAR_NAMES: Record<string, string> = {
  'red-bull': 'RB21', ferrari: 'SF-25', mclaren: 'MCL39', 'aston-martin': 'AMR25',
  alpine: 'A525', williams: 'FW47', 'racing-bulls': 'VCARB01',
};

/** The one circuit with a driving surface today. Others are on the calendar as coming. */
const DRIVABLE = new Set(['shanghai']);
const PACE_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Real F1' };
const FINISH_LABEL: Record<keyof typeof FINISHES, string> = { gloss: 'Gloss', satin: 'Satin', matte: 'Matte', metallic: 'Metallic', pearl: 'Pearl' };
const PATTERN_LABEL: Record<Livery['pattern'], string> = {
  solid: 'Solid', twoTone: 'Two-tone', spine: 'Spine', diagonal: 'Split', arrow: 'Arrow', halftone: 'Halftone', nose: 'Nose', stripes: 'Stripes',
};
const COMPOUND_LIST = ['soft', 'medium', 'hard'] as const;
const ANGLES: { id: PictureAngle; label: string }[] = [
  { id: 'front', label: 'Front' }, { id: 'side', label: 'Side' }, { id: 'rear', label: 'Rear' }, { id: 'above', label: 'Above' },
];
const TABS = [
  { id: 'car', label: 'Car' },
  { id: 'driver', label: 'Driver' },
  { id: 'race', label: 'Race' },
  { id: 'share', label: 'Share' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function teamOf(teamId: string) {
  return TEAMS_2026.find((team) => team.id === teamId) ?? TEAMS_2026[0];
}

function teammates(teamId: string) {
  return DRIVERS_2026.filter((driver) => driver.teamId === teamId);
}

function luma(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255;
}

/** The running dot's colour: the livery's brightest colour that is not near white. */
function dotColour(livery: Livery) {
  const options = [livery.secondary, livery.accent, livery.primary];
  const sorted = options.slice().sort((a, b) => {
    const la = luma(a) > 0.85 ? -1 : luma(a);
    const lb = luma(b) > 0.85 ? -1 : luma(b);
    return lb - la;
  });
  return sorted[0];
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable);
}

/** Short message at the top of the stage. */
function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef(0);
  const show = useCallback((text: string, seconds = 1.8) => {
    setMessage(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), seconds * 1000);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { message, show };
}

/**
 * The front door: the car on a turntable in a showroom, a card of tabs to
 * choose the car and driver, set up the race and share a picture, and the
 * circuit drawn as the race button. Choosing another car paints it over the
 * one on the turntable.
 */
export function Showroom() {
  const shared = useMemo(() => decodeGarage(readHashParams()), []);
  const [index, setIndex] = useState(() => {
    const id = shared.driverId ?? readSelectedDriverId();
    const found = DRIVERS_2026.findIndex((driver) => driver.id === id);
    return found < 0 ? 0 : found;
  });
  const [compound, setCompound] = useState<GarageState['compound']>(shared.compound ?? 'soft');
  const [straight, setStraight] = useState(shared.straight ?? false);
  const [angle, setAngle] = useState<PictureAngle>(shared.angle ?? 'front');
  const [spinning, setSpinning] = useState(true);
  const [tab, setTab] = useState<TabId>('car');
  const [circuitId, setCircuitId] = useState('shanghai');
  const [pickingCircuit, setPickingCircuit] = useState(false);
  const [laps, setLaps] = useState(5);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  // Phones open with the sheet folded, so the car has the screen.
  const [sheetOpen, setSheetOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 900);
  const [inset, setInset] = useState<FrameInset>({ right: 0, bottom: 0, top: 0 });
  const toast = useToast();
  const captureRef = useRef<ShowroomCapture | null>(null);
  const card = useRef<HTMLElement>(null);
  const side = useRef<HTMLElement>(null);
  const tabsId = useId();

  const driver = DRIVERS_2026[index];
  const team = teamOf(driver.teamId);
  const livery = liveryFor(team.id);
  const crew = teammates(team.id);
  const pod = crew[0]?.id === driver.id ? 'first' : 'second';
  const profile = findProfile(driver.id);
  const circuit = findCircuit(circuitId) ?? findCircuit('shanghai')!;
  const touch = useCoarsePointer();
  const nameParts = driver.name.split(/\s+/);
  const state: GarageState = { driverId: driver.id, compound, straight, angle };

  useEffect(() => {
    if (shared.driverId) toast.show(`${driver.name} · ${team.name}: shared with you`, 2.6);
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The address always carries the car, once the visitor has changed something.
  const touched = useRef(Boolean(shared.driverId));
  useEffect(() => {
    if (!touched.current) return;
    const timer = window.setTimeout(() => {
      window.history.replaceState(null, '', encodeGarage(state));
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver.id, compound, straight, angle]);
  const markTouched = () => { touched.current = true; };

  // Frame the car in what the card leaves free.
  useLayoutEffect(() => {
    const element = card.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const phone = window.innerWidth < 900;
      const head = side.current?.getBoundingClientRect();
      setInset(phone
        ? { right: 0, bottom: Math.max(0, window.innerHeight - rect.top), top: head ? Math.max(0, head.bottom) : 0 }
        : { right: Math.max(0, window.innerWidth - rect.left) + 6, bottom: 0, top: 0 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (side.current) observer.observe(side.current);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [sheetOpen]);

  const choose = useCallback((next: number, towards: number) => {
    if (next === index) return;
    uiSound.flip(towards);
    markTouched();
    setIndex(next);
    persistSelectedDriverId(DRIVERS_2026[next].id);
    const nextDriver = DRIVERS_2026[next];
    if (nextDriver.teamId !== driver.teamId) toast.show(`${liveryFor(nextDriver.teamId).name} · ${teamOf(nextDriver.teamId).name}`);
  }, [driver.teamId, index, toast]);
  const move = useCallback((delta: number) => choose((index + delta + DRIVERS_2026.length) % DRIVERS_2026.length, Math.sign(delta) || 1), [choose, index]);
  const chooseTeam = (teamId: string) => {
    const seat = pod === 'first' ? 0 : 1;
    const target = teammates(teamId)[seat] ?? teammates(teamId)[0];
    const next = DRIVERS_2026.findIndex((candidate) => candidate.id === target.id);
    choose(next, next >= index ? 1 : -1);
  };

  const start = useCallback(() => {
    uiSound.confirm();
    gameStore.getState().configure({ driverId: driver.id, laps, difficulty });
    gameStore.getState().start();
    window.location.hash = '#/play/race';
  }, [difficulty, driver.id, laps]);

  // Picture and link actions.
  const pictureInfo: PictureInfo = { driverName: driver.name, driverCode: driver.abbreviation, number: driver.number, teamName: team.name, carName: CAR_NAMES[team.id], livery };
  const renderPicture = useCallback((width = 1920, height = 1080, at: PictureAngle = angle) => {
    const render = captureRef.current?.(at, width, height);
    return render ? composePicture(render, pictureInfo) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [angle, driver.id]);
  const copyLink = useCallback(async () => {
    markTouched();
    const url = garageUrl(state);
    try {
      await navigator.clipboard.writeText(url);
      toast.show('Link copied: it opens this exact car');
    } catch {
      toast.show('Copy the link from the box below');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver.id, compound, straight, angle, toast]);
  const savePicture = useCallback(async () => {
    toast.show('Rendering the picture…', 3);
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    const picture = renderPicture();
    const blob = picture ? await canvasBlob(picture) : null;
    if (!blob) { toast.show('The picture could not be rendered'); return; }
    downloadBlob(blob, pictureFilename(pictureInfo));
    toast.show('Picture saved');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderPicture, toast]);
  const copyPicture = useCallback(async () => {
    const picture = renderPicture();
    const blob = picture ? await canvasBlob(picture) : null;
    if (!blob) { toast.show('The picture could not be rendered'); return; }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast.show('Picture copied');
    } catch {
      downloadBlob(blob, pictureFilename(pictureInfo));
      toast.show('Copying pictures is blocked here, so it was saved instead', 2.6);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderPicture, toast]);
  const sharePicture = useCallback(async () => {
    markTouched();
    const url = garageUrl(state);
    const title = `${driver.name} · ${team.name}`;
    try {
      const picture = renderPicture();
      const blob = picture ? await canvasBlob(picture) : null;
      const file = blob ? new File([blob], pictureFilename(pictureInfo), { type: 'image/png' }) : null;
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title, text: `${title}, on the APEX grid`, url });
      } else if (navigator.share) {
        await navigator.share({ title, url });
      } else {
        await copyLink();
      }
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') toast.show('Sharing failed, so try Copy link');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyLink, renderPicture, toast, driver.id]);

  // Keys, as on the card's hints.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.getAttribute('role') === 'tab') return;
      if (pickingCircuit) { if (event.code === 'Escape') setPickingCircuit(false); return; }
      const digit = /^Digit([1-7])$/.exec(event.code);
      if (digit && !event.shiftKey) { event.preventDefault(); chooseTeam(LIVERIES[Number(digit[1]) - 1].teamId); return; }
      switch (event.code) {
        case 'ArrowLeft': event.preventDefault(); move(-1); break;
        case 'ArrowRight': event.preventDefault(); move(1); break;
        case 'KeyG': markTouched(); setStraight((value) => !value); uiSound.click(0.6); break;
        case 'KeyT': markTouched(); setCompound((value) => COMPOUND_LIST[(COMPOUND_LIST.indexOf(value) + 1) % 3]); uiSound.click(0.4); break;
        case 'Space': if (!(event.target instanceof HTMLButtonElement)) { event.preventDefault(); setSpinning((value) => !value); } break;
        case 'KeyL': void copyLink(); break;
        case 'KeyP': void savePicture(); break;
        case 'Enter': if (!(event.target instanceof HTMLButtonElement) && !(event.target instanceof HTMLAnchorElement)) start(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onTabKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const position = TABS.findIndex((entry) => entry.id === tab);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = TABS[(position + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
      setTab(next.id);
      document.getElementById(`${tabsId}-${next.id}`)?.focus();
    }
  };

  const ratings = [
    ['Pace', driver.ratings.pace],
    ['Qualifying', driver.ratings.qualifying],
    ['Overtaking', driver.ratings.overtaking],
    ['Defending', driver.ratings.defending],
  ] as const;
  const racecraft = Math.round(((driver.ratings.overtaking + driver.ratings.defending) / 2) * 100);

  return (
    <div className="garage" style={{ ...teamThemeStyle(driver.id), '--sheet-h': `${inset.bottom}px` } as React.CSSProperties}>
      <div className="garage__stage" aria-hidden="true">
        <ShowroomScene
          livery={livery}
          number={driver.number}
          pod={pod}
          straight={straight}
          compound={compound}
          spinning={spinning}
          lite={touch}
          inset={inset}
          captureRef={captureRef}
        />
        <div className="garage__vignette" />
      </div>

      <AppNav active="home" />

      <section ref={side} className="garage__side" aria-label="Your driver">
        <p className="garage__eyebrow">{team.name} · {CAR_NAMES[team.id]}</p>
        <div className="garage__ident">
          <span className="garage__number" aria-hidden="true">{wideDigits(driver.number)}</span>
          <h1 className="garage__name">{nameParts.map((part) => <span key={part}>{part}</span>)}</h1>
        </div>
        <p className="garage__hook">{profile?.hook}</p>
        <dl className="garage__stats">
          <div><dt>Pace</dt><dd>{Math.round(driver.ratings.pace * 100)}</dd></div>
          <div><dt>Quali</dt><dd>{Math.round(driver.ratings.qualifying * 100)}</dd></div>
          <div className="is-hot"><dt>Racecraft</dt><dd>{racecraft}</dd></div>
        </dl>
      </section>

      <section ref={card} className={sheetOpen ? 'garage__card' : 'garage__card is-min'} aria-label="Garage">
        <button type="button" className="garage__grip" aria-label={sheetOpen ? 'Collapse the card' : 'Expand the card'} aria-expanded={sheetOpen} onClick={() => setSheetOpen((open) => !open)}><span /></button>
        <div className="garage__tabs" role="tablist" aria-label="Garage sections">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              id={`${tabsId}-${entry.id}`}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              aria-controls={`${tabsId}-${entry.id}-pane`}
              tabIndex={tab === entry.id ? 0 : -1}
              className={tab === entry.id ? 'is-on' : undefined}
              onKeyDown={onTabKey}
              onClick={() => {
                if (tab === entry.id && window.innerWidth < 900) { setSheetOpen((open) => !open); return; }
                uiSound.click(0.35 + TABS.indexOf(entry) * 0.12);
                setTab(entry.id);
                setSheetOpen(true);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="garage__panes">
          <div key={tab} id={`${tabsId}-${tab}-pane`} role="tabpanel" aria-labelledby={`${tabsId}-${tab}`} className="garage__pane">
            {tab === 'car' && (
              <>
                <Field label="Team liveries" hint="1–7 · ‹ ›" value={livery.name}>
                  <div className="garage__liveries" role="radiogroup" aria-label="Team livery">
                    {LIVERIES.map((entry, position) => {
                      const selected = entry.teamId === team.id;
                      return (
                        <button
                          key={entry.teamId}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={`${teamOf(entry.teamId).name}: ${entry.name}`}
                          title={`${teamOf(entry.teamId).name} · ${entry.name} (${position + 1})`}
                          className={selected ? 'garage__chip is-on' : 'garage__chip'}
                          style={{ background: `linear-gradient(135deg, ${entry.primary} 0 50%, ${entry.secondary} 50% 100%)`, '--dot': entry.accent } as React.CSSProperties}
                          onClick={() => chooseTeam(entry.teamId)}
                        />
                      );
                    })}
                  </div>
                </Field>
                <dl className="garage__spec">
                  <div><dt>Car</dt><dd>{CAR_NAMES[team.id]}</dd></div>
                  <div><dt>Pattern</dt><dd>{PATTERN_LABEL[livery.pattern]}</dd></div>
                  <div><dt>Finish</dt><dd>{FINISH_LABEL[livery.finish]}</dd></div>
                </dl>
                <Field label="Wings" hint="G">
                  <Segmented
                    label="Wing mode"
                    value={straight ? 'straight' : 'corner'}
                    options={[{ id: 'corner', label: 'Corner' }, { id: 'straight', label: 'Straight' }]}
                    onChange={(value) => { markTouched(); setStraight(value === 'straight'); }}
                  />
                </Field>
                <Field label="Tyres" hint="T" value={compound[0].toUpperCase() + compound.slice(1)}>
                  <div className="garage__dots" role="radiogroup" aria-label="Tyre compound">
                    {COMPOUND_LIST.map((entry) => (
                      <button
                        key={entry}
                        type="button"
                        role="radio"
                        aria-checked={compound === entry}
                        aria-label={`${entry} tyres`}
                        className={compound === entry ? 'garage__tyre is-on' : 'garage__tyre'}
                        style={{ '--band': COMPOUNDS[entry] } as React.CSSProperties}
                        onClick={() => { markTouched(); setCompound(entry); uiSound.click(0.5); }}
                      />
                    ))}
                    <button type="button" className={spinning ? 'garage__pill is-on' : 'garage__pill'} aria-pressed={spinning} onClick={() => setSpinning((value) => !value)} title="Turntable (Space)">
                      {spinning ? 'Turning' : 'Still'}
                    </button>
                  </div>
                </Field>
              </>
            )}

            {tab === 'driver' && (
              <>
                <Field label={`${team.name} drivers`} hint="‹ ›">
                  <div className="garage__seats" role="radiogroup" aria-label="Driver">
                    {crew.map((candidate) => {
                      const selected = candidate.id === driver.id;
                      return (
                        <button
                          key={candidate.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={selected ? 'garage__seat is-on' : 'garage__seat'}
                          onClick={() => { const next = DRIVERS_2026.findIndex((entry) => entry.id === candidate.id); choose(next, next >= index ? 1 : -1); }}
                        >
                          <span className="garage__seat-num"><WideNumber value={candidate.number} /></span>
                          <span className="garage__seat-name">{candidate.name}</span>
                          <small>{candidate.abbreviation}</small>
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <Field label="Ratings">
                  <dl className="garage__ratings">
                    {ratings.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd><span className="garage__meter"><i style={{ width: `${Math.round(value * 100)}%` }} /></span><em>{Math.round(value * 100)}</em></dd>
                      </div>
                    ))}
                  </dl>
                </Field>
                {profile?.hook && <p className="garage__note">{profile.hook}</p>}
              </>
            )}

            {tab === 'race' && (
              <>
                <Field label="Circuit" value={`R${circuit.round}`}>
                  <button type="button" className="garage__circuit" onClick={() => { uiSound.open(); setPickingCircuit(true); }} aria-haspopup="dialog">
                    <span className="garage__circuit-map"><CircuitMap circuit={circuit} /></span>
                    <span className="garage__circuit-text">
                      <strong>{circuit.name}</strong>
                      <span>{circuit.lengthKm.toFixed(3)} km · {circuit.turns} turns · {circuit.drsZones ?? 0} DRS</span>
                      <em>Change circuit ↗</em>
                    </span>
                  </button>
                </Field>
                <Field label="Laps" value={String(laps)}>
                  <Segmented label="Laps" value={String(laps)} options={[1, 3, 5].map((value) => ({ id: String(value), label: String(value) }))} onChange={(value) => setLaps(Number(value))} />
                </Field>
                <Field label="AI pace" value={PACE_LABEL[difficulty]}>
                  <Segmented label="AI pace" value={difficulty} options={(['easy', 'medium', 'hard'] as const).map((value) => ({ id: value, label: PACE_LABEL[value] }))} onChange={(value) => setDifficulty(value as Difficulty)} />
                </Field>
              </>
            )}

            {tab === 'share' && (
              <SharePane
                renderPreview={renderPicture}
                previewKey={`${driver.id}|${angle}|${compound}|${straight}`}
                url={garageUrl(state)}
                angle={angle}
                onAngle={(value) => { markTouched(); setAngle(value); }}
                onCopyLink={copyLink}
                onSave={savePicture}
                onCopyPicture={copyPicture}
                onShare={sharePicture}
              />
            )}
          </div>
        </div>

        <div className="garage__foot">
          <button type="button" className="garage__start" onClick={start}>
            <span>Start race</span>
            <small>{circuit.name.replace(' International Circuit', '')} · {laps} laps · {PACE_LABEL[difficulty]}</small>
          </button>
        </div>
      </section>

      <CircuitTeaser colour={dotColour(livery)} circuitName={circuit.name.replace(' International Circuit', '')} laps={laps} onStart={start} />

      <p className={toast.message ? 'garage__toast is-on' : 'garage__toast'} role="status" aria-live="polite">{toast.message}</p>

      {pickingCircuit && (
        <div className="showroom__picker" role="dialog" aria-modal="true" aria-label="Choose a circuit">
          <div className="showroom__picker-sheet">
            <header>
              <p className="showroom__eyebrow">2026 calendar</p>
              <h2>Choose a circuit</h2>
              <button type="button" className="shell-btn" onClick={() => { uiSound.click(0.2); setPickingCircuit(false); }}>Close</button>
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
                      onClick={() => { uiSound.click(0.8); setCircuitId(round.id); setPickingCircuit(false); }}
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

function Field({ label, hint, value, children }: { label: string; hint?: string; value?: string; children: ReactNode }) {
  return (
    <div className="garage__field">
      <p className="garage__lab">
        <span>{label}</span>
        {value && <span className="garage__v">{value}</span>}
        {hint && <em>{hint}</em>}
      </p>
      {children}
    </div>
  );
}

function Segmented({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: readonly { id: string; label: string }[];
  onChange(value: string): void;
}) {
  return (
    <div className="garage__seg" role="radiogroup" aria-label={label}>
      {options.map((option, position) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          className={option.id === value ? 'is-on' : undefined}
          onClick={() => { if (option.id !== value) uiSound.click(options.length > 1 ? position / (options.length - 1) : 0.5); onChange(option.id); }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const ICONS = {
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  save: <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />,
  copy: <path d="M9 9h10v10H9zM5 15V5h10" />,
  share: <path d="M12 15V4m0 0L8 8m4-4 4 4M6 12v7h12v-7" />,
};

function SharePane({ renderPreview, previewKey, url, angle, onAngle, onCopyLink, onSave, onCopyPicture, onShare }: {
  renderPreview(width: number, height: number): HTMLCanvasElement | null;
  previewKey: string;
  url: string;
  angle: PictureAngle;
  onAngle(angle: PictureAngle): void;
  onCopyLink(): void;
  onSave(): void;
  onCopyPicture(): void;
  onShare(): void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const picture = renderPreview(960, 540);
      setPreview(picture ? picture.toDataURL('image/jpeg', 0.85) : null);
    }, preview ? 700 : 120);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);
  const actions = [
    { id: 'link', label: 'Copy link', run: onCopyLink, icon: ICONS.link, hint: 'L' },
    { id: 'save', label: 'Save picture', run: onSave, icon: ICONS.save, hint: 'P' },
    { id: 'copy', label: 'Copy picture', run: onCopyPicture, icon: ICONS.copy },
    { id: 'share', label: 'Share…', run: onShare, icon: ICONS.share },
  ];
  return (
    <>
      <div className="garage__preview">
        {preview ? <img src={preview} alt="Picture preview of your car" /> : <span>Picture preview</span>}
      </div>
      <div className="garage__share">
        {actions.map((action) => (
          <button key={action.id} type="button" onClick={action.run} title={action.hint ? `${action.label} (${action.hint})` : action.label}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{action.icon}</svg>
            <span>{action.label}</span>
          </button>
        ))}
      </div>
      <input className="garage__link" readOnly value={url} aria-label="Link to this car" onFocus={(event) => event.currentTarget.select()} />
      <Field label="Picture angle" value={ANGLES.find((entry) => entry.id === angle)?.label}>
        <Segmented label="Picture angle" value={angle} options={ANGLES} onChange={(value) => onAngle(value as PictureAngle)} />
      </Field>
      <p className="garage__note">The link holds the whole car: anyone who opens it sees exactly this. <b>L</b> copies it, <b>P</b> saves the picture.</p>
    </>
  );
}
