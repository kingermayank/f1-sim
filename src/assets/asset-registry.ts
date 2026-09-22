/** Public runtime URLs for the race scene. Keep these paths stable for loaders. */
export const ASSETS = {
  track: '/assets/models/shanghai-track.glb',
  car: '/assets/models/f1-car.glb',
  teamCar: (teamId: string) => `/assets/models/cars/${teamId}.glb`,
  /** About a tenth of the triangles and 256 px textures: what a rival more than a few dozen metres away draws. */
  teamCarLod: (teamId: string) => `/assets/models/cars-lod/${teamId}.glb`,
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
