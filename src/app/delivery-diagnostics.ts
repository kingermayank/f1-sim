import type { StoreApi } from 'zustand/vanilla';
import type { RaceAudioDiagnostics } from '../audio/race-audio';
import { EFFECT_POOL_CAPACITY } from '../scene/RaceEffects';
import type { RaceStoreState } from '../store/race-store';

interface AudioDiagnosticsSource {
  getDiagnostics(): RaceAudioDiagnostics;
}

export interface DeliveryDiagnosticsSnapshot {
  seed: string;
  phase: RaceStoreState['snapshot']['phase'];
  tick: number;
  carCount: number;
  canvasCount: number;
  effects: {
    capacity: typeof EFFECT_POOL_CAPACITY;
    active: number;
  };
  audio: RaceAudioDiagnostics;
  scenario: {
    activePitCars: number;
    incidentCount: number;
    pitEntryCount: number;
    safetyCarCount: number;
    safetyCarState: RaceStoreState['snapshot']['safetyCar'];
  };
}

export interface DeliveryDiagnostics {
  snapshot(): DeliveryDiagnosticsSnapshot;
  advanceRace(presentationSeconds: number): void;
  finishRace(): void;
  restartRace(seed: string): void;
}

declare global {
  interface Window {
    __RACE_DIAGNOSTICS__?: DeliveryDiagnostics;
  }
}

function activeEffectCount(state: RaceStoreState): number {
  if (!state.effectsEnabled) return 0;
  const incident = [...state.eventFeed].reverse().find((event) => event.type === 'incident');
  if (!incident) return 0;
  const activeCar = state.snapshot.cars.some((car) => car.driverId === incident.driverIds[0] && car.status === 'running');
  const ageSeconds = Math.max(0, (state.snapshot.tick - incident.tick) / 10);
  if (!activeCar || ageSeconds >= 4) return 0;
  const smoke = state.reducedMotion ? 8 : EFFECT_POOL_CAPACITY.smoke;
  const sparks = state.reducedMotion || ageSeconds >= 1.15 ? 0 : EFFECT_POOL_CAPACITY.sparks;
  const debris = state.reducedMotion ? 6 : EFFECT_POOL_CAPACITY.debris;
  return smoke + sparks + debris;
}

export function createDeliveryDiagnostics(
  store: StoreApi<RaceStoreState>,
  audio: AudioDiagnosticsSource,
): DeliveryDiagnostics {
  return {
    snapshot() {
      const state = store.getState();
      const events = state.snapshot.events;
      return Object.freeze({
        seed: state.snapshot.seed,
        phase: state.snapshot.phase,
        tick: state.snapshot.tick,
        carCount: state.snapshot.cars.length,
        canvasCount: document.querySelectorAll('.race-viewport canvas').length,
        effects: Object.freeze({ capacity: EFFECT_POOL_CAPACITY, active: activeEffectCount(state) }),
        audio: Object.freeze(audio.getDiagnostics()),
        scenario: Object.freeze({
          activePitCars: state.snapshot.cars.filter((car) => car.pitState !== 'track').length,
          incidentCount: events.filter((event) => event.type === 'incident').length,
          pitEntryCount: events.filter((event) => event.type === 'pit-entry').length,
          safetyCarCount: events.filter((event) => event.type === 'flag' && event.flag === 'safety-car').length,
          safetyCarState: state.snapshot.safetyCar,
        }),
      });
    },
    advanceRace(presentationSeconds) {
      if (!Number.isFinite(presentationSeconds) || presentationSeconds < 0) {
        throw new RangeError('Diagnostic presentation time must be finite and non-negative');
      }
      const state = store.getState();
      if (state.isPaused) state.togglePause();
      store.getState().tick(presentationSeconds);
    },
    finishRace() {
      const state = store.getState();
      if (state.isPaused) state.togglePause();
      store.getState().tick(3_600);
    },
    restartRace(seed) {
      if (!seed.trim()) throw new RangeError('Diagnostic seed must not be empty');
      store.getState().restart(seed);
    },
  };
}

export function installDeliveryDiagnostics(
  store: StoreApi<RaceStoreState>,
  audio: AudioDiagnosticsSource,
  development: boolean,
): (() => void) | undefined {
  if (!development || new URLSearchParams(window.location.search).get('diagnostics') !== '1') return undefined;
  const diagnostics = createDeliveryDiagnostics(store, audio);
  window.__RACE_DIAGNOSTICS__ = diagnostics;
  return () => {
    if (window.__RACE_DIAGNOSTICS__ === diagnostics) delete window.__RACE_DIAGNOSTICS__;
  };
}
