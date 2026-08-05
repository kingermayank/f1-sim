import { useEffect } from 'react';
import { raceStore } from './race-store';

export function RacePreferenceBridge() {
  useEffect(() => {
    let query: MediaQueryList | undefined;
    try { query = window.matchMedia?.('(prefers-reduced-motion: reduce)'); } catch { return; }
    if (!query) return;
    const update = () => raceStore.getState().updateSystemReducedMotion(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return null;
}
