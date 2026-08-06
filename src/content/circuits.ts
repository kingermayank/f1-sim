import { SHANGHAI_RACE_LAPS, SHANGHAI_TRACK } from '../track/shanghai-track';

export interface CornerNote {
  /** Lap fraction, 0 at the start/finish line. */
  distance: number;
  label: string;
  note: string;
}

export interface Circuit {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  /** Only a circuit with a real model and track definition can be raced. */
  status: 'playable' | 'planned';
  lengthKm: number;
  laps: number;
  turns: number;
  longestStraightKm?: number;
  drsZones?: number;
  /** Normalised 0-100 SVG path, traced from the simulation's own centerline. */
  outline?: string;
  summary?: string;
  corners?: CornerNote[];
}

/**
 * Shanghai's outline is traced from the fitted centerline in the track
 * definition, so the map on the browse pages is the same geometry the cars
 * actually drive. Placeholder circuits carry no outline and are labelled as
 * unavailable rather than being faked.
 */
function traceOutline(points: readonly { x: number; z: number }[], samples = 120): string {
  const step = Math.max(1, Math.ceil(points.length / samples));
  const taken = points.filter((_, index) => index % step === 0);
  const xs = taken.map((p) => p.x);
  const zs = taken.map((p) => p.z);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...zs) - minZ) || 1;
  return `${taken
    .map((p, index) => `${index ? 'L' : 'M'}${(((p.x - minX) / span) * 100).toFixed(2)} ${(((p.z - minZ) / span) * 100).toFixed(2)}`)
    .join(' ')} Z`;
}

export const SHANGHAI_OUTLINE = traceOutline(SHANGHAI_TRACK.centerLine);

export const CIRCUITS: readonly Circuit[] = [
  {
    id: 'shanghai',
    name: 'Shanghai International Circuit',
    country: 'China',
    countryCode: 'CHN',
    status: 'playable',
    lengthKm: 5.451,
    laps: SHANGHAI_RACE_LAPS,
    turns: 16,
    longestStraightKm: 1.17,
    drsZones: 2,
    outline: SHANGHAI_OUTLINE,
    summary:
      'The opening corner spirals inward for nearly 270 degrees, so drivers are still turning long '
      + 'after they expect to be finished. Later, a 1.17 km straight runs into a tight hairpin — the '
      + 'best overtaking spot on the lap. Those two features decide most races here.',
    corners: [
      {
        distance: 0.05,
        label: 'Turns 1-4 · the spiral',
        note:
          'The corner keeps tightening for almost 270 degrees. Brake too late and you are still '
          + 'turning when the road runs out, which costs far more than the time you saved.',
      },
      {
        distance: 0.38,
        label: 'Turns 7-8 · the switchback',
        note:
          'A quick left-right where the car has to change direction twice with no straight in '
          + 'between. Get the first one wrong and the second is already lost.',
      },
      {
        distance: 0.62,
        label: 'Turn 13 · the long right',
        note:
          'Held for a long time at high load, which scrubs the front-left tyre. Push here early in a '
          + 'stint and you pay for it ten laps later.',
      },
      {
        distance: 0.74,
        label: 'Back straight · 1.17 km',
        note:
          'The longest straight on the calendar outside Baku. If a driver is close enough at the '
          + 'detection point, this is where the overtake happens.',
      },
      {
        distance: 0.84,
        label: 'Turn 14 · the hairpin',
        note:
          'Heavy braking from very high speed into a slow corner. The classic passing spot, and the '
          + 'classic place to lock a front tyre and flat-spot it.',
      },
    ],
  },
  { id: 'monza', name: 'Monza', country: 'Italy', countryCode: 'ITA', status: 'planned', lengthKm: 5.793, laps: 53, turns: 11 },
  { id: 'monaco', name: 'Monaco', country: 'Monaco', countryCode: 'MON', status: 'planned', lengthKm: 3.337, laps: 78, turns: 19 },
  { id: 'silverstone', name: 'Silverstone', country: 'United Kingdom', countryCode: 'GBR', status: 'planned', lengthKm: 5.891, laps: 52, turns: 18 },
  { id: 'suzuka', name: 'Suzuka', country: 'Japan', countryCode: 'JPN', status: 'planned', lengthKm: 5.807, laps: 53, turns: 18 },
  { id: 'spa', name: 'Spa-Francorchamps', country: 'Belgium', countryCode: 'BEL', status: 'planned', lengthKm: 7.004, laps: 44, turns: 19 },
  { id: 'interlagos', name: 'Interlagos', country: 'Brazil', countryCode: 'BRA', status: 'planned', lengthKm: 4.309, laps: 71, turns: 15 },
  { id: 'jeddah', name: 'Jeddah Corniche', country: 'Saudi Arabia', countryCode: 'KSA', status: 'planned', lengthKm: 6.174, laps: 50, turns: 27 },
];

export function findCircuit(id: string | undefined): Circuit | undefined {
  return CIRCUITS.find((circuit) => circuit.id === id);
}

export const PLAYABLE_CIRCUITS = CIRCUITS.filter((circuit) => circuit.status === 'playable');
