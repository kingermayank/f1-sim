export interface Prng {
  next(): number;
  range(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(values: readonly T[]): T;
}

function hash(seed: string): number {
  let value = 2166136261;
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

export function createPrng(seed: string): Prng {
  let state = hash(seed) || 1;

  const next = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    chance: (probability) => next() < probability,
    pick: <T>(values: readonly T[]): T => {
      if (values.length === 0) throw new Error('Cannot pick from an empty array');
      const index = Math.min(values.length - 1, Math.floor(next() * values.length));
      return values[index]!;
    },
  };
}
