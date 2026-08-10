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
} as const;

export type PlayableCircuitId = keyof typeof LOADERS;
export const PLAYABLE_CIRCUIT_IDS = Object.freeze(Object.keys(LOADERS) as PlayableCircuitId[]);

export function loadCircuitRuntime(id: PlayableCircuitId): Promise<CircuitRuntime> {
  return LOADERS[id]();
}
