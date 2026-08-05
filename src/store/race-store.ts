import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { DEFAULT_RACE_CONFIG } from '../domain/race-config';
import { DRIVERS_2026 } from '../domain/grid-2026';
import type { RaceConfig } from '../domain/race-types';
import { createRaceEngine, type RaceEngine } from '../simulation/race-engine';
import type { RaceEvent, RaceState } from '../simulation/events';
import { MONACO_TRACK } from '../track/monaco-track';

export const PLAYBACK_SPEEDS = [1, 2, 4, 8] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export const CAMERA_MODES = ['broadcast', 'chase', 'cockpit', 'overhead', 'free'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export const QUALITY_MODES = ['auto', 'high', 'mobile'] as const;
export type QualityMode = (typeof QUALITY_MODES)[number];

const EVENT_FEED_LIMIT = 100;

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

let generatedSeedCounter = 0;

function createNewSeed(): string {
  generatedSeedCounter += 1;
  return `monaco-2026-${Date.now().toString(36)}-${generatedSeedCounter}`;
}

export function createRaceStore(initialConfig: RaceConfig = DEFAULT_RACE_CONFIG) {
  let engine: RaceEngine = createRaceEngine(initialConfig, MONACO_TRACK, DRIVERS_2026);

  return createStore<RaceStoreState>((set, get) => {
    const resetRace = (config: RaceConfig): void => {
      engine = createRaceEngine(config, MONACO_TRACK, DRIVERS_2026);
      set({
        config: immutableConfig(config),
        snapshot: engine.snapshot(),
        eventFeed: immutableEventFeed([]),
        isPaused: false,
        speed: 1,
        selectedDriverId: null,
        cameraMode: 'broadcast',
      });
    };

    return {
      config: immutableConfig(initialConfig),
      snapshot: engine.snapshot(),
      eventFeed: immutableEventFeed([]),
      isPaused: false,
      speed: 1,
      selectedDriverId: null,
      cameraMode: 'broadcast',
      labelsEnabled: true,
      effectsEnabled: true,
      audioMuted: false,
      reducedMotion: false,
      qualityMode: 'auto',
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
        if (isCameraMode(cameraMode)) set({ cameraMode });
      },
      toggleLabels(): void {
        set((state) => ({ labelsEnabled: !state.labelsEnabled }));
      },
      toggleEffects(): void {
        set((state) => ({ effectsEnabled: !state.effectsEnabled }));
      },
      toggleAudio(): void {
        set((state) => ({ audioMuted: !state.audioMuted }));
      },
      toggleReducedMotion(): void {
        set((state) => ({ reducedMotion: !state.reducedMotion }));
      },
      setQualityMode(qualityMode): void {
        if (QUALITY_MODES.includes(qualityMode)) set({ qualityMode });
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
