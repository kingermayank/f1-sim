import type { Prng } from './prng';

export type OvertakeDecision = 'none' | 'attack' | 'pass' | 'failed' | 'contact';

export interface OvertakeInput {
  paceAdvantage: number;
  gapSeconds: number;
  passingZone: boolean;
  attackerSkill: number;
  defenderSkill: number;
}

export function evaluateOvertake(input: OvertakeInput, prng: Prng): OvertakeDecision {
  if (
    !input.passingZone
    || input.gapSeconds < 0
    || input.gapSeconds > 1.15
    || input.paceAdvantage <= 0
  ) return 'none';

  const pressure = Math.min(1, input.paceAdvantage * 7 + (1.15 - input.gapSeconds) * 0.35);
  const skillEdge = input.attackerSkill - input.defenderSkill;
  const attemptChance = Math.min(0.82, Math.max(0.08, 0.16 + pressure * 0.38 + skillEdge * 0.2));
  if (!prng.chance(attemptChance)) return 'none';

  const contactChance = Math.max(0.002, 0.018 - input.attackerSkill * 0.012 + pressure * 0.006);
  if (prng.chance(contactChance)) return 'contact';

  const passChance = Math.min(0.78, Math.max(0.08, 0.25 + pressure * 0.34 + skillEdge * 0.32));
  if (prng.chance(passChance)) return 'pass';
  return prng.chance(0.55) ? 'attack' : 'failed';
}

