export interface PaceInput {
  basePace: number;
  consistencyNoise: number;
  tireGrip: number;
  fuelFactor: number;
  trafficFactor: number;
  slipstreamFactor: number;
  damageFactor: number;
  flagFactor: number;
}

/** Full fuel costs roughly 3.5% pace, falling to a small low-fuel benefit. */
export function calculateFuelFactor(completedLaps: number, raceLaps: number): number {
  if (!Number.isFinite(completedLaps) || !Number.isFinite(raceLaps) || raceLaps <= 0) {
    throw new RangeError('Fuel distance and race length must be finite, with a positive race length');
  }
  const burnedFraction = Math.min(1, Math.max(0, completedLaps / raceLaps));
  return 0.965 + burnedFraction * 0.05;
}

export function calculateTargetPace(input: PaceInput): number {
  return Math.max(
    0.15,
    input.basePace
      * input.tireGrip
      * input.fuelFactor
      * input.trafficFactor
      * input.slipstreamFactor
      * input.damageFactor
      * input.flagFactor
      * (1 + input.consistencyNoise),
  );
}
