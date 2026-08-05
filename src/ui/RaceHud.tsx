import { useEffect, useState } from 'react';
import { useRaceStore } from '../store/race-store';
import { CreditsPanel } from './CreditsPanel';
import { DriverPanel } from './DriverPanel';
import { EventFeed } from './EventFeed';
import { FinishScreen } from './FinishScreen';
import { Leaderboard } from './Leaderboard';
import { PlaybackControls } from './PlaybackControls';
import { TrackMap } from './TrackMap';
import { titleCase } from './formatters';

export function RaceHud() {
  const [timingOpen, setTimingOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [compactLayout, setCompactLayout] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 760);
  useEffect(() => {
    const update = () => setCompactLayout(window.innerWidth <= 760);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const snapshot = useRaceStore((state) => state.snapshot);
  const eventFeed = useRaceStore((state) => state.eventFeed);
  const selectedDriverId = useRaceStore((state) => state.selectedDriverId);
  const selectDriver = useRaceStore((state) => state.selectDriver);
  const replaySeed = useRaceStore((state) => state.replaySeed);
  const restart = useRaceStore((state) => state.restart);
  const currentLap = Math.min(78, Math.max(1, ...snapshot.cars.map((car) => car.lap + 1)));
  return (
    <div className="race-hud">
      <header className="race-header">
        <div className="race-header__brand"><span className="race-header__mark" aria-hidden="true">MC</span><div><p>Principauté de Monaco · 2026</p><strong>Harbor Grand Prix</strong></div></div>
        <div className="race-state">
          <span className={`flag flag--${snapshot.flag}`} aria-label={`Race flag: ${titleCase(snapshot.flag)}`}><i aria-hidden="true" />{titleCase(snapshot.flag)}</span>
          <strong aria-label="Current lap">Lap {currentLap} / 78</strong>
          <span>{titleCase(snapshot.weather)} · 24°C</span>
        </div>
        <div className="race-meta"><span>Simulation seed</span><code aria-label="Simulation seed">{snapshot.seed}</code><button type="button" onClick={() => setCreditsOpen(true)} aria-label="Open credits and disclosure">Credits</button></div>
      </header>

      <button type="button" className="timing-drawer-toggle" aria-label="Toggle timing tower" aria-expanded={timingOpen} aria-controls={!compactLayout || timingOpen ? 'timing-drawer' : undefined} onClick={() => setTimingOpen((value) => !value)}><span>Classification</span><strong>{timingOpen ? 'Close' : 'P1–P22'}</strong></button>
      {(!compactLayout || timingOpen) && (
        <aside id="timing-drawer" className="race-hud__left" data-open={timingOpen}>
          <Leaderboard snapshot={snapshot} selectedDriverId={selectedDriverId} onSelect={(id) => { selectDriver(id); setTimingOpen(false); }} />
        </aside>
      )}

      <aside className="race-hud__right">
        <DriverPanel snapshot={snapshot} selectedDriverId={selectedDriverId} />
        <TrackMap snapshot={snapshot} selectedDriverId={selectedDriverId} />
        <EventFeed events={eventFeed} raceId={snapshot.seed} />
      </aside>

      <PlaybackControls onOpenCredits={() => setCreditsOpen(true)} />
      {snapshot.phase === 'finished' && <FinishScreen snapshot={snapshot} onReplay={replaySeed} onNewRace={() => restart()} />}
      <CreditsPanel open={creditsOpen} onClose={() => setCreditsOpen(false)} />
    </div>
  );
}
