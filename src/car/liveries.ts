/**
 * Team liveries for the code-drawn car.
 *
 * A livery is three colours, a pattern and a finish. The pattern is computed
 * by the paint shader in the car's own space, across every painted part at
 * once, so a stripe runs from the nose over the sidepods and up the engine
 * cover without a seam. These are abstract designs in each team's colours:
 * no logos, word marks or sponsor marks.
 */

export const PATTERNS = {
  /** One colour with a pinstripe at the waist and a dark skirt. */
  solid: 0,
  /** Upper and lower halves split along a rising waistline, pinstriped. */
  twoTone: 1,
  /** A wide band down the spine, nose to engine cover. */
  spine: 2,
  /** Front and rear split by a raked plane through the sidepods. */
  diagonal: 3,
  /** A chevron pointing forward along the nose and sidepods. */
  arrow: 4,
  /** Front fades into rear through a field of halftone dots. */
  halftone: 5,
  /** Dark base, a coloured band low along the sidepods, a bright nose tip. */
  nose: 6,
  /** Three raked speed stripes along each side. */
  stripes: 7,
} as const;

export type PatternName = keyof typeof PATTERNS;

export interface Finish {
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  /** Thin-film sheen, for pearl. */
  iridescence: number;
  /** Visible metallic flake, for metallic paints. */
  flake: number;
}

export const FINISHES = {
  gloss: { roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.035, iridescence: 0, flake: 0 },
  satin: { roughness: 0.44, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.24, iridescence: 0, flake: 0 },
  matte: { roughness: 0.62, metalness: 0, clearcoat: 0, clearcoatRoughness: 0.5, iridescence: 0, flake: 0 },
  metallic: { roughness: 0.36, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0, flake: 1 },
  pearl: { roughness: 0.3, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 1, flake: 0.45 },
} as const satisfies Record<string, Finish>;

export type FinishName = keyof typeof FINISHES;

export interface Livery {
  teamId: string;
  /** What the livery is called on the card. */
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  pattern: PatternName;
  finish: FinishName;
  /** Driver number ink. */
  numberInk: string;
  helmet: string;
  helmetStripe: string;
  rim: string;
}

export const LIVERIES: readonly Livery[] = [
  {
    teamId: 'ferrari', name: 'Rosso Corsa', pattern: 'spine', finish: 'gloss',
    primary: '#c8001a', secondary: '#f5f4f0', accent: '#ffd400',
    numberInk: '#ffffff', helmet: '#d6001c', helmetStripe: '#ffd400', rim: '#1d1f22',
  },
  {
    teamId: 'mclaren', name: 'Papaya', pattern: 'twoTone', finish: 'gloss',
    primary: '#ff7a00', secondary: '#1b1e23', accent: '#3fc4ff',
    numberInk: '#111317', helmet: '#ff8a1c', helmetStripe: '#1b1e23', rim: '#16181b',
  },
  {
    teamId: 'red-bull', name: 'Midnight', pattern: 'nose', finish: 'matte',
    primary: '#15204a', secondary: '#d4182c', accent: '#ffc906',
    numberInk: '#ffffff', helmet: '#1a2c6b', helmetStripe: '#ffc906', rim: '#1a1c20',
  },
  {
    teamId: 'racing-bulls', name: 'Halftone', pattern: 'halftone', finish: 'pearl',
    primary: '#eef1f8', secondary: '#1840d0', accent: '#e8293a',
    numberInk: '#1840d0', helmet: '#f2f4fa', helmetStripe: '#1840d0', rim: '#202227',
  },
  {
    teamId: 'alpine', name: 'Pink & Blue', pattern: 'diagonal', finish: 'gloss',
    primary: '#ff7ab4', secondary: '#0b4c9e', accent: '#ffffff',
    numberInk: '#ffffff', helmet: '#0b4c9e', helmetStripe: '#ff7ab4', rim: '#15171a',
  },
  {
    teamId: 'williams', name: 'Deep Blue', pattern: 'stripes', finish: 'gloss',
    primary: '#0a2a66', secondary: '#00a3e0', accent: '#ffffff',
    numberInk: '#ffffff', helmet: '#0b3a85', helmetStripe: '#00a3e0', rim: '#1a1c1f',
  },
  {
    teamId: 'aston-martin', name: 'Racing Green', pattern: 'arrow', finish: 'metallic',
    primary: '#0a5a42', secondary: '#c9db00', accent: '#0b0f0d',
    numberInk: '#c9db00', helmet: '#0f6a4e', helmetStripe: '#c9db00', rim: '#141617',
  },
];

export function liveryFor(teamId: string): Livery {
  return LIVERIES.find((livery) => livery.teamId === teamId) ?? LIVERIES[0];
}

/** The second car of a team carries a yellow camera pod; the first a black one, as on the grid. */
export const CAMERA_POD = { first: '#111214', second: '#f5d800' } as const;
