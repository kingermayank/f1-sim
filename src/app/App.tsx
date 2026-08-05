import './styles.css';
import { RaceScene } from '../scene/RaceScene';
import { RaceHud } from '../ui/RaceHud';
import { RaceAudioBridge } from '../audio/RaceAudioBridge';

export function App() {
  return (
    <main className="app-shell">
      <h1 className="visually-hidden">Monaco 2026 Simulation</h1>
      <RaceScene />
      <RaceHud />
      <RaceAudioBridge />
    </main>
  );
}
