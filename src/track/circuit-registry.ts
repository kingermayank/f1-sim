import type { CircuitRuntime } from './circuit-runtime';

const LOADERS = {
  shanghai: async (): Promise<CircuitRuntime> => {
    const { SHANGHAI_RACE_LAPS, SHANGHAI_TRACK } = await import('./shanghai-track');
    return {
      id: 'shanghai',
      laps: SHANGHAI_RACE_LAPS,
      assetUrl: '/assets/models/shanghai-track.glb',
      track: { ...SHANGHAI_TRACK, id: 'shanghai' },
    };
  },
  suzuka: async (): Promise<CircuitRuntime> => {
    const { SUZUKA_RACE_LAPS, SUZUKA_TRACK } = await import('./generated/suzuka-track');
    return {
      id: 'suzuka',
      laps: SUZUKA_RACE_LAPS,
      assetUrl: '/assets/models/tracks/suzuka.glb',
      track: SUZUKA_TRACK,
    };
  },
  melbourne: async (): Promise<CircuitRuntime> => {
    const { MELBOURNE_RACE_LAPS, MELBOURNE_TRACK } = await import('./generated/melbourne-track');
    return {
      id: 'melbourne',
      laps: MELBOURNE_RACE_LAPS,
      assetUrl: '/assets/models/tracks/melbourne.glb',
      track: MELBOURNE_TRACK,
    };
  },
  barcelona: async (): Promise<CircuitRuntime> => {
    const { BARCELONA_RACE_LAPS, BARCELONA_TRACK } = await import('./generated/barcelona-track');
    return {
      id: 'barcelona',
      laps: BARCELONA_RACE_LAPS,
      assetUrl: '/assets/models/tracks/barcelona.glb',
      track: BARCELONA_TRACK,
    };
  },
  spa: async (): Promise<CircuitRuntime> => {
    const { SPA_RACE_LAPS, SPA_TRACK } = await import('./generated/spa-track');
    return {
      id: 'spa',
      laps: SPA_RACE_LAPS,
      assetUrl: '/assets/models/tracks/spa.glb',
      track: SPA_TRACK,
    };
  },
  silverstone: async (): Promise<CircuitRuntime> => {
    const { SILVERSTONE_RACE_LAPS, SILVERSTONE_TRACK } = await import('./generated/silverstone-track');
    return {
      id: 'silverstone',
      laps: SILVERSTONE_RACE_LAPS,
      assetUrl: '/assets/models/tracks/silverstone.glb',
      track: SILVERSTONE_TRACK,
    };
  },
} as const;

export type PlayableCircuitId = keyof typeof LOADERS;
export const PLAYABLE_CIRCUIT_IDS = Object.freeze(Object.keys(LOADERS) as PlayableCircuitId[]);

export function loadCircuitRuntime(id: PlayableCircuitId): Promise<CircuitRuntime> {
  return LOADERS[id]();
}
