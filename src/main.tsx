import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { installDeliveryDiagnostics } from './app/delivery-diagnostics';
import { raceAudioController } from './audio/race-audio';
import { raceStore } from './store/race-store';

installDeliveryDiagnostics(raceStore, raceAudioController, import.meta.env.DEV || import.meta.env.MODE === 'e2e');

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
