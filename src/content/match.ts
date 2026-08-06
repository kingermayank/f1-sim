import { DRIVERS_2026 } from '../domain/grid-2026';
import type { Ratings } from '../domain/race-types';

/**
 * Find My Driver.
 *
 * Matching runs against the SAME ratings the simulation uses to race, so the
 * driver you are matched with genuinely behaves the way the quiz described.
 * Nothing here is invented for the quiz.
 */
export interface MatchOption {
  id: string;
  label: string;
  /** Rating dimensions this answer favours, each weighted 0-1. */
  weights: Partial<Record<keyof Ratings, number>>;
}

export interface MatchQuestion {
  id: string;
  prompt: string;
  options: MatchOption[];
}

export const MATCH_QUESTIONS: readonly MatchQuestion[] = [
  {
    id: 'approach',
    prompt: 'A gap opens up, but it is half a gap at best. You…',
    options: [
      { id: 'send', label: 'Send it and sort the consequences out later', weights: { overtaking: 1, incidentAvoidance: -0.6 } },
      { id: 'wait', label: 'Wait a lap and set it up properly', weights: { consistency: 0.8, tireManagement: 0.5 } },
    ],
  },
  {
    id: 'defence',
    prompt: 'Someone faster is right behind you. Your instinct is to…',
    options: [
      { id: 'block', label: 'Make yourself impossible to pass', weights: { defending: 1 } },
      { id: 'pace', label: 'Focus on your own lap and let the pace decide', weights: { pace: 0.8, consistency: 0.6 } },
    ],
  },
  {
    id: 'weather',
    prompt: 'It starts raining hard mid-race. You are…',
    options: [
      { id: 'thrilled', label: 'Thrilled — this is where you make the difference', weights: { wetSkill: 1 } },
      { id: 'cautious', label: 'Cautious — bring it home in one piece', weights: { reliability: 0.7, incidentAvoidance: 0.8 } },
    ],
  },
  {
    id: 'saturday',
    prompt: 'Which matters more to you?',
    options: [
      { id: 'quali', label: 'One perfect qualifying lap', weights: { qualifying: 1 } },
      { id: 'race', label: 'Grinding out a strong race', weights: { tireManagement: 0.8, consistency: 0.7 } },
    ],
  },
  {
    id: 'tyres',
    prompt: 'Your tyres are going off with fifteen laps to go. You…',
    options: [
      { id: 'manage', label: 'Nurse them to the end and think two moves ahead', weights: { tireManagement: 1, consistency: 0.5 } },
      { id: 'push', label: 'Push anyway and hope it holds', weights: { pace: 0.9, overtaking: 0.4 } },
    ],
  },
  {
    id: 'career',
    prompt: 'Where are you in your story?',
    options: [
      { id: 'young', label: 'Everything to prove, nothing to lose', weights: { qualifying: 0.6, overtaking: 0.7, incidentAvoidance: -0.4 } },
      { id: 'seasoned', label: 'Been here a while and know exactly how it works', weights: { defending: 0.7, consistency: 0.8, reliability: 0.5 } },
    ],
  },
];

export interface MatchResult {
  driverId: string;
  /** 0-1, how strongly the winning driver fits. */
  affinity: number;
}

/**
 * Scores every driver against the accumulated answer weights and returns the
 * closest fit. Ties resolve to the higher-scoring driver in iteration order,
 * which is stable across runs.
 */
export function matchDriver(answers: readonly MatchOption[]): MatchResult | null {
  if (answers.length === 0) return null;

  const weights = new Map<keyof Ratings, number>();
  for (const answer of answers) {
    for (const [key, value] of Object.entries(answer.weights)) {
      const dimension = key as keyof Ratings;
      weights.set(dimension, (weights.get(dimension) ?? 0) + (value ?? 0));
    }
  }

  const scores = DRIVERS_2026.map((driver) => {
    let score = 0;
    for (const [dimension, weight] of weights) {
      score += (driver.ratings[dimension] ?? 0) * weight;
    }
    return { driverId: driver.id, score };
  });

  const highest = Math.max(...scores.map((entry) => entry.score));
  const lowest = Math.min(...scores.map((entry) => entry.score));
  const winner = scores.find((entry) => entry.score === highest);
  if (!winner) return null;

  // Affinity is the winner's position within the spread across the whole grid,
  // so a decisive match reads differently from a near-tie.
  const span = highest - lowest;
  const runnerUp = scores
    .filter((entry) => entry.driverId !== winner.driverId)
    .reduce((max, entry) => Math.max(max, entry.score), lowest);
  const affinity = span > 0 ? Math.min(1, 0.6 + ((highest - runnerUp) / span) * 0.4) : 1;

  return { driverId: winner.driverId, affinity };
}

/** Points for a podium prediction: exact place is worth more than presence. */
export const PREDICTION_POINTS = { exact: 5, onPodium: 2 } as const;

export function scorePrediction(picks: readonly string[], actualPodium: readonly string[]): number {
  let score = 0;
  picks.forEach((pick, index) => {
    if (actualPodium[index] === pick) score += PREDICTION_POINTS.exact;
    else if (actualPodium.includes(pick)) score += PREDICTION_POINTS.onPodium;
  });
  return score;
}

export const MAX_PREDICTION_SCORE = PREDICTION_POINTS.exact * 3;

/** A seed that changes daily, so there is a fresh race to call each day. */
export function dailySeed(date: Date = new Date()): string {
  const iso = date.toISOString().slice(0, 10);
  return `apex-daily-${iso}`;
}
