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
