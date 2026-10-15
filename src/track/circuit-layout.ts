import layout from './generated/shanghai-circuit-layout.json';

/**
 * The APEX Shanghai circuit's trackside layout, generated from the same
 * centreline the cars drive on (scripts/circuit/export-shanghai-layout.mjs)
 * and built into the circuit model from that same data. The game reads it so
 * that the barrier a car hits is the barrier it sees, and the surface it slows
 * on is the one drawn there.
 *
 * Sides use the projected track's sign: +1 is positive lateral offset.
 */

/** What lies beyond the kerb: grass, asphalt run-off, gravel, the pit wall's asphalt, or the pit lane opening. */
export type Runoff = 'g' | 'a' | 'r' | 'p' | 'o';

export const CIRCUIT_LAYOUT = layout;
const ROWS = layout.rows;

/** Outer edge of a kerb, metres from the centreline. */
export const KERB_OUTER_METRES = 8;

function sideKey(side: number): 'left' | 'right' {
  return side >= 0 ? 'left' : 'right';
}

function rowPosition(fraction: number): number {
  return ((((fraction % 1) + 1) % 1) * ROWS);
}

/**
 * How far from the centreline the car's centre can go on one side before it
 * is against the barrier, interpolated between the layout's 2 m rows.
 */
export function wallAt(fraction: number, side: number): number {
  const position = rowPosition(fraction);
  const row = Math.floor(position) % ROWS;
  const next = (row + 1) % ROWS;
  const walls = layout.wall[sideKey(side)];
  return walls[row] + (walls[next] - walls[row]) * (position - Math.floor(position));
}

export function runoffAt(fraction: number, side: number): Runoff {
  return layout.runoff[sideKey(side)][Math.round(rowPosition(fraction)) % ROWS] as Runoff;
}

export function kerbAt(fraction: number, side: number): boolean {
  return layout.kerb[sideKey(side)][Math.round(rowPosition(fraction)) % ROWS] === '1';
}
