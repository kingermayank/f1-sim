/** Public runtime URLs for the race scene. Keep these paths stable for loaders. */
export const ASSETS = {
  track: '/assets/models/monaco-track.glb',
  car: '/assets/models/f1-car.glb',
  teamTexture: (teamId: string) => `/assets/textures/teams/${teamId}.webp`,
} as const;

export type AssetCredit = {
  id: string;
  title: string;
  creator: string;
  source: string;
  license: string;
  licenseUrl: string;
  downloadedAt: string;
  originalFile: string;
  runtimeFile: string;
  modifications: string;
};
