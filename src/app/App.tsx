import './styles.css';
import './shell.css';
import { RaceScene } from '../scene/RaceScene';
import { RaceHud } from '../ui/RaceHud';
import { RaceAudioBridge } from '../audio/RaceAudioBridge';
import { RacePreferenceBridge } from '../store/RacePreferenceBridge';
import { ExplainPanel } from '../explain/ExplainPanel';
import { AppNav } from '../shell/AppNav';
import { LearnView } from '../shell/LearnView';
import { CircuitView, CircuitsView, DriversView, GarageView, HomeView } from '../shell/views';
import { routeHref, useRoute } from '../shell/router';

/** The race view, unchanged, with Explain Mode layered beside it. */
function RaceRoute() {
  return (
    <>
      <a className="race-exit" href={routeHref('home')} aria-label="Exit to APEX home">← APEX <span className="race-exit__sub">/ Exit</span></a>
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

  if (route.name === 'race') {
    return (
      <main className="app-shell">
        <h1 className="visually-hidden">Shanghai 2026 Simulation</h1>
        <RaceRoute />
      </main>
    );
  }

  return (
    <main className="app-shell app-shell--browse">
      <AppNav active={route.name} />
      {route.name === 'home' && <HomeView />}
      {route.name === 'circuits' && <CircuitsView />}
      {route.name === 'circuit' && <CircuitView id={route.param} />}
      {route.name === 'garage' && <GarageView />}
      {route.name === 'drivers' && <DriversView />}
      {route.name === 'learn' && <LearnView />}
    </main>
  );
}
