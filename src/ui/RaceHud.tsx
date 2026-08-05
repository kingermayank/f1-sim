import { useEffect, useRef, useState } from 'react';
import { DRIVERS_2026 } from '../domain/grid-2026';
import { getClassification } from '../simulation/selectors';
import { useRaceStore } from '../store/race-store';
import { AccessibleDialog } from './AccessibleDialog';
import { CreditsPanel } from './CreditsPanel';
import { DriverPanel } from './DriverPanel';
import { EventFeed } from './EventFeed';
import { FinishScreen } from './FinishScreen';
import { Leaderboard } from './Leaderboard';
import { PlaybackControls, PreferenceControls } from './PlaybackControls';
import { TrackMap } from './TrackMap';
import { formatDuration, titleCase } from './formatters';
import { SHANGHAI_RACE_LAPS } from '../track/shanghai-track';

export function RaceHud() {
  const [timingOpen, setTimingOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [compactLayout, setCompactLayout] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 760);
  const [secondaryLayout, setSecondaryLayout] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1200);
  const timingToggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const update = () => {
      setCompactLayout(window.innerWidth <= 760);
      setSecondaryLayout(window.innerWidth < 1200);
    };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  useEffect(() => {
    if (!compactLayout || !timingOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setTimingOpen(false);
      timingToggleRef.current?.focus();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [compactLayout, timingOpen]);
  useEffect(() => {
    if (!secondaryLayout) setMoreOpen(false);
  }, [secondaryLayout]);
  const snapshot = useRaceStore((state) => state.snapshot);
  const eventFeed = useRaceStore((state) => state.eventFeed);
  const speed = useRaceStore((state) => state.speed);
  const selectedDriverId = useRaceStore((state) => state.selectedDriverId);
  const selectDriver = useRaceStore((state) => state.selectDriver);
  const replaySeed = useRaceStore((state) => state.replaySeed);
  const restart = useRaceStore((state) => state.restart);
  const currentLap = Math.min(SHANGHAI_RACE_LAPS, Math.max(1, ...snapshot.cars.map((car) => car.lap + 1)));
  const leader = getClassification(snapshot)[0];
  const leaderName = DRIVERS_2026.find((driver) => driver.id === leader?.driverId)?.name ?? '—';
  const closeTiming = () => {
    setTimingOpen(false);
    timingToggleRef.current?.focus();
  };
  return (
    <div className="race-hud">
      <header className="race-header">
        <div className="race-header__brand"><span className="race-header__mark" aria-hidden="true">SH</span><div><p>Shanghai · 2026</p><strong>Chinese Grand Prix</strong></div></div>
        <div className="race-state">
          <span className={`flag flag--${snapshot.flag}`} aria-label={`Race flag: ${titleCase(snapshot.flag)}`}><i aria-hidden="true" />{titleCase(snapshot.flag)}</span>
          <strong aria-label="Current lap">Lap {currentLap} / {SHANGHAI_RACE_LAPS}</strong>
          <span className="race-state__stat" aria-label="Elapsed simulation time"><small>Time</small>{formatDuration(snapshot.elapsedSeconds)}</span>
          <span className="race-state__stat" aria-label="Playback speed"><small>Speed</small>{speed}×</span>
          <span className="race-state__stat race-state__leader" aria-label="Race leader"><small>Leader</small>{leaderName}</span>
          <span className="race-state__weather">{titleCase(snapshot.weather)} · 24°C</span>
        </div>
        <div className="race-meta"><span>Simulation seed</span><code aria-label="Simulation seed">{snapshot.seed}</code><button type="button" onClick={() => setCreditsOpen(true)} aria-label="Open credits and disclosure">Credits</button></div>
      </header>

      <button ref={timingToggleRef} type="button" className="timing-drawer-toggle" aria-label="Toggle timing tower" aria-expanded={timingOpen} aria-controls={!compactLayout || timingOpen ? 'timing-drawer' : undefined} onClick={() => setTimingOpen((value) => !value)}><span>Classification</span><strong>{timingOpen ? 'Close' : 'P1–P22'}</strong></button>
      {compactLayout && timingOpen && <button type="button" className="timing-drawer-backdrop" aria-label="Close timing tower" onClick={closeTiming} />}
      {(!compactLayout || timingOpen) && (
        <aside id="timing-drawer" className="race-hud__left" data-open={timingOpen}>
          <Leaderboard snapshot={snapshot} selectedDriverId={selectedDriverId} onSelect={(id) => { selectDriver(id); setTimingOpen(false); }} />
        </aside>
      )}

      <aside className="race-hud__right" aria-label="Selected driver" aria-hidden={compactLayout && timingOpen ? 'true' : undefined} data-obscured={compactLayout && timingOpen}>
        <DriverPanel snapshot={snapshot} selectedDriverId={selectedDriverId} />
        {!secondaryLayout && <TrackMap snapshot={snapshot} selectedDriverId={selectedDriverId} />}
        {!secondaryLayout && <EventFeed events={eventFeed} raceId={snapshot.seed} />}
      </aside>

      <PlaybackControls onOpenCredits={() => setCreditsOpen(true)} compactPreferences={secondaryLayout} onOpenMore={() => setMoreOpen(true)} />
      {secondaryLayout && moreOpen && (
        <AccessibleDialog className="more-panel" labelledBy="more-panel-title" onClose={() => setMoreOpen(false)}>
          <header><div><p>Race desk</p><h2 id="more-panel-title">More race information</h2></div><button type="button" className="modal-close" aria-label="Close more race information" data-autofocus onClick={() => setMoreOpen(false)}>×</button></header>
          <div className="more-panel__content"><TrackMap snapshot={snapshot} selectedDriverId={selectedDriverId} /><EventFeed events={eventFeed} raceId={snapshot.seed} /></div>
          <section className="more-panel__preferences" aria-labelledby="more-preferences-title"><h3 id="more-preferences-title">Presentation preferences</h3><PreferenceControls onOpenCredits={() => { setMoreOpen(false); setCreditsOpen(true); }} /></section>
        </AccessibleDialog>
      )}
      {snapshot.phase === 'finished' && <FinishScreen snapshot={snapshot} onReplay={replaySeed} onNewRace={() => restart()} />}
      <CreditsPanel open={creditsOpen} onClose={() => setCreditsOpen(false)} />
    </div>
  );
}
