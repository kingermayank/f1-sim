import './styles.css';
import { RaceScene } from '../scene/RaceScene';

export function App() {
  return (
    <main className="app-shell">
      <header className="app-heading">
        <p className="app-heading__eyebrow">Principauté de Monaco · 2026</p>
        <h1>Monaco 2026 Simulation</h1>
      </header>
      <RaceScene />
    </main>
  );
}
