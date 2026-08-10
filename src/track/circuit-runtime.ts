import type { TrackDefinition } from './track-types';

export interface CircuitRuntime {
  id: string;
  laps: number;
  assetUrl: string;
  track: TrackDefinition;
}
