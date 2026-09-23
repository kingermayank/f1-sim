import './styles.css';
import './shell.css';
import { useEffect, useState } from 'react';
import { RaceScene } from '../scene/RaceScene';
import { RaceHud } from '../ui/RaceHud';
import { RaceAudioBridge } from '../audio/RaceAudioBridge';
import { RacePreferenceBridge } from '../store/RacePreferenceBridge';
import { ExplainPanel } from '../explain/ExplainPanel';
import { AppNav } from '../shell/AppNav';
import { CircuitView, CircuitsView, DriversView, GarageView } from '../shell/views';
import { routeHref, useRoute } from '../shell/router';
import { Showroom } from '../shell/Showroom';
import { HomepageMusic } from '../shell/HomepageMusic';
import { readSelectedDriverId, TEAM_THEME_EVENT, teamThemeStyle } from '../shell/team-theme';
import { PlayRaceView } from '../game/PlayViews';

/** The race view, unchanged, with Explain Mode layered beside it. */
function RaceRoute() {
  return (
    <>
      <a className="race-exit" href={routeHref('home')}>← Back to APEX</a>
      <RaceScene />
      <RaceHud />
      <ExplainPanel />
      <RaceAudioBridge />
      <RacePreferenceBridge />
    </>
  );
}

export function App() {
  const route = useRoute();
  const [themeDriverId, setThemeDriverId] = useState(readSelectedDriverId);

  useEffect(() => {
    const syncTheme = () => setThemeDriverId(readSelectedDriverId());
    window.addEventListener(TEAM_THEME_EVENT, syncTheme);
    window.addEventListener('storage', syncTheme);
    return () => {
      window.removeEventListener(TEAM_THEME_EVENT, syncTheme);
      window.removeEventListener('storage', syncTheme);
    };
  }, []);

  if (route.name === 'play-race') {
    return (
      <main className="app-shell">
        <h1 className="visually-hidden">APEX race</h1>
        <PlayRaceView />
      </main>
    );
  }

  if (route.name === 'race') {
    return (
      <main className="app-shell">
        <h1 className="visually-hidden">Shanghai 2026 Simulation</h1>
        <RaceRoute />
      </main>
    );
  }

  // Keep one soundtrack controller mounted across every arcade/menu route.
  // Race routes return above and own their separate engine/broadcast audio.
  const page = route.name === 'home' || route.name === 'play' ? (
      <main className="app-shell app-shell--showroom">
        <Showroom />
      </main>
  ) : (
    <main className="app-shell app-shell--browse" style={teamThemeStyle(themeDriverId)}>
      <AppNav active={route.name} />
      {route.name === 'circuits' && <CircuitsView />}
      {route.name === 'circuit' && <CircuitView id={route.param} />}
      {route.name === 'garage' && <GarageView />}
      {route.name === 'drivers' && <DriversView />}
    </main>
  );

  return (
    <>
      <HomepageMusic />
      {page}
    </>
  );
}
