import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { DEFAULT_RACE_CONFIG } from '../domain/race-config';
import { DRIVERS_2026 } from '../domain/grid-2026';
import type { RaceConfig } from '../domain/race-types';
import { createRaceEngine, type RaceEngine } from '../simulation/race-engine';
import type { RaceEvent, RaceState } from '../simulation/events';
import { MONACO_TRACK } from '../track/monaco-track';

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export const CAMERA_MODES = ['broadcast', 'chase', 'cockpit', 'overhead', 'free'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export const QUALITY_MODES = ['auto', 'high', 'mobile'] as const;
export type QualityMode = (typeof QUALITY_MODES)[number];

const EVENT_FEED_LIMIT = 100;
export const PREFERENCES_STORAGE_KEY = 'monaco-race.preferences.v1';

interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RaceStoreOptions {
  storage?: PreferenceStorage | null;
  prefersReducedMotion?: boolean;
}

interface PersistedPreferences {
  version: 1;
  muted: boolean;
  reducedMotion: boolean | null;
  labels: boolean;
  effects: boolean;
  quality: QualityMode;
  cameraMode: CameraMode;
}

const DEFAULT_PREFERENCES: PersistedPreferences = {
  version: 1,
  muted: true,
  reducedMotion: null,
  labels: true,
  effects: true,
  quality: 'auto',
  cameraMode: 'broadcast',
};

export type ImmutableRaceEvent<T extends RaceEvent = RaceEvent> = T extends { driverIds: string[] }
  ? Readonly<Omit<T, 'driverIds'>> & { readonly driverIds: readonly string[] }
  : Readonly<T>;

export interface RaceStoreState {
  config: Readonly<RaceConfig>;
  snapshot: Readonly<RaceState>;
  eventFeed: readonly ImmutableRaceEvent[];
  isPaused: boolean;
  speed: PlaybackSpeed;
  selectedDriverId: string | null;
  cameraMode: CameraMode;
  labelsEnabled: boolean;
  effectsEnabled: boolean;
  audioMuted: boolean;
  reducedMotion: boolean;
  qualityMode: QualityMode;
  tick(deltaSeconds: number): void;
  togglePause(): void;
  setSpeed(speed: PlaybackSpeed): void;
  selectDriver(driverId: string | null): void;
  setCameraMode(cameraMode: CameraMode): void;
  toggleLabels(): void;
  toggleEffects(): void;
  toggleAudio(): void;
  toggleReducedMotion(): void;
  updateSystemReducedMotion(reducedMotion: boolean): void;
  setQualityMode(qualityMode: QualityMode): void;
  restart(seed?: string): void;
  replaySeed(): void;
}

function immutableConfig(config: RaceConfig): Readonly<RaceConfig> {
  return Object.freeze({ ...config });
}

function immutableEvent(event: RaceEvent | ImmutableRaceEvent): ImmutableRaceEvent {
  if (event.type === 'incident') return Object.freeze({ ...event, driverIds: Object.freeze([...event.driverIds]) });
  return Object.freeze({ ...event });
}

function immutableEventFeed(events: readonly (RaceEvent | ImmutableRaceEvent)[]): readonly ImmutableRaceEvent[] {
  return Object.freeze(events.map(immutableEvent));
}

function isPlaybackSpeed(value: number): value is PlaybackSpeed {
  return PLAYBACK_SPEEDS.includes(value as PlaybackSpeed);
}

function isCameraMode(value: string): value is CameraMode {
  return CAMERA_MODES.includes(value as CameraMode);
}

function browserPreferenceOptions(): Required<RaceStoreOptions> {
  let storage: PreferenceStorage | null = null;
  let prefersReducedMotion = false;
  if (typeof window !== 'undefined') {
    try { storage = window.localStorage; } catch { storage = null; }
    try { prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; } catch { prefersReducedMotion = false; }
  }
  return { storage, prefersReducedMotion };
}

function readPreferences(storage: PreferenceStorage | null): PersistedPreferences {
  if (!storage) return DEFAULT_PREFERENCES;
  try {
    const parsed = JSON.parse(storage.getItem(PREFERENCES_STORAGE_KEY) ?? 'null') as Partial<PersistedPreferences> | null;
    if (
      !parsed || parsed.version !== 1 || typeof parsed.muted !== 'boolean'
      || !(typeof parsed.reducedMotion === 'boolean' || parsed.reducedMotion === null)
      || typeof parsed.labels !== 'boolean' || typeof parsed.effects !== 'boolean'
      || typeof parsed.quality !== 'string' || !QUALITY_MODES.includes(parsed.quality as QualityMode)
      || typeof parsed.cameraMode !== 'string' || !isCameraMode(parsed.cameraMode)
    ) return DEFAULT_PREFERENCES;
    return parsed as PersistedPreferences;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

let generatedSeedCounter = 0;

function createNewSeed(): string {
  generatedSeedCounter += 1;
  return `monaco-2026-${Date.now().toString(36)}-${generatedSeedCounter}`;
}

export function createRaceStore(initialConfig: RaceConfig = DEFAULT_RACE_CONFIG, options: RaceStoreOptions = browserPreferenceOptions()) {
  let engine: RaceEngine = createRaceEngine(initialConfig, MONACO_TRACK, DRIVERS_2026);
  const storage = options.storage ?? null;
  const preferences = readPreferences(storage);
  let reducedMotionPreference = preferences.reducedMotion;

  return createStore<RaceStoreState>((set, get) => {
    const persistPreferences = (): void => {
      const state = get();
      const next: PersistedPreferences = {
        version: 1,
        muted: state.audioMuted,
        reducedMotion: reducedMotionPreference,
        labels: state.labelsEnabled,
        effects: state.effectsEnabled,
        quality: state.qualityMode,
        cameraMode: state.cameraMode,
      };
      try { storage?.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(next)); } catch { /* Storage can be blocked or full. */ }
    };

    const resetRace = (config: RaceConfig): void => {
      engine = createRaceEngine(config, MONACO_TRACK, DRIVERS_2026);
      set({
        config: immutableConfig(config),
        snapshot: engine.snapshot(),
        eventFeed: immutableEventFeed([]),
        isPaused: false,
        speed: 1,
        selectedDriverId: null,
      });
    };

    return {
      config: immutableConfig(initialConfig),
      snapshot: engine.snapshot(),
      eventFeed: immutableEventFeed([]),
      isPaused: false,
      speed: 1,
      selectedDriverId: null,
      cameraMode: preferences.cameraMode,
      labelsEnabled: preferences.labels,
      effectsEnabled: preferences.effects,
      audioMuted: preferences.muted,
      reducedMotion: reducedMotionPreference ?? options.prefersReducedMotion ?? false,
      qualityMode: preferences.quality,
      tick(deltaSeconds): void {
        const { isPaused, speed, eventFeed } = get();
        if (isPaused) return;

        engine.advance(deltaSeconds * speed);
        const nextFeed = [...eventFeed, ...engine.drainEvents()].slice(-EVENT_FEED_LIMIT);
        set({ snapshot: engine.snapshot(), eventFeed: immutableEventFeed(nextFeed) });
      },
      togglePause(): void {
        set((state) => ({ isPaused: !state.isPaused }));
      },
      setSpeed(speed): void {
        if (isPlaybackSpeed(speed)) set({ speed });
      },
      selectDriver(driverId): void {
        set({ selectedDriverId: driverId });
      },
      setCameraMode(cameraMode): void {
        if (isCameraMode(cameraMode)) { set({ cameraMode }); persistPreferences(); }
      },
      toggleLabels(): void {
        set((state) => ({ labelsEnabled: !state.labelsEnabled }));
        persistPreferences();
      },
      toggleEffects(): void {
        set((state) => ({ effectsEnabled: !state.effectsEnabled }));
        persistPreferences();
      },
      toggleAudio(): void {
        set((state) => ({ audioMuted: !state.audioMuted }));
        persistPreferences();
      },
      toggleReducedMotion(): void {
        set((state) => {
          reducedMotionPreference = !state.reducedMotion;
          return { reducedMotion: reducedMotionPreference };
        });
        persistPreferences();
      },
      updateSystemReducedMotion(reducedMotion): void {
        if (reducedMotionPreference === null) set({ reducedMotion });
      },
      setQualityMode(qualityMode): void {
        if (QUALITY_MODES.includes(qualityMode)) { set({ qualityMode }); persistPreferences(); }
      },
      restart(seed): void {
        resetRace({ ...get().config, seed: seed ?? createNewSeed() });
      },
      replaySeed(): void {
        resetRace(get().config);
      },
    };
  });
}

export const raceStore = createRaceStore();

export function useRaceStore<T>(selector: (state: RaceStoreState) => T): T {
  return useStore(raceStore, selector);
}
