import './styles.css';
import { RaceScene } from '../scene/RaceScene';
import { RaceHud } from '../ui/RaceHud';
import { RaceAudioBridge } from '../audio/RaceAudioBridge';
import { RacePreferenceBridge } from '../store/RacePreferenceBridge';

export function App() {
  return (
    <main className="app-shell">
      <h1 className="visually-hidden">Shanghai 2026 Simulation</h1>
      <RaceScene />
      <RaceHud />
      <RaceAudioBridge />
      <RacePreferenceBridge />
    </main>
  );
}
