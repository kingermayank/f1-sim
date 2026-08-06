/**
 * Local-only progress. No accounts, no backend, no cross-device sync — a
 * deliberate product decision to keep signup friction at zero.
 *
 * Every read is defensive: storage can be disabled, full, or contain data
 * written by an older version, and none of those should break the page.
 */
export const PROGRESS_STORAGE_KEY = 'apex.progress.v1';

export interface PredictionRecord {
  /** Seed the prediction was made against, so a result can be recomputed. */
  seed: string;
  picks: string[];
  score: number;
}

export interface Progress {
  version: 1;
  /** Best quiz score so far, out of the number of questions answered. */
  bestQuizScore: number;
  quizAttempts: number;
  /** Driver id chosen by Find My Driver. */
  matchedDriverId: string | null;
  /** Most recent podium prediction, so a repeat visit shows the result. */
  lastPrediction: PredictionRecord | null;
  /** Consecutive predictions that scored at least one point. */
  predictionStreak: number;
  bestPredictionScore: number;
}

export const DEFAULT_PROGRESS: Progress = {
  version: 1,
  bestQuizScore: 0,
  quizAttempts: 0,
  matchedDriverId: null,
  lastPrediction: null,
  predictionStreak: 0,
  bestPredictionScore: 0,
};

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage; } catch { return null; }
}

export function readProgress(storage: Storage | null = browserStorage()): Progress {
  if (!storage) return DEFAULT_PROGRESS;
  try {
    const parsed = JSON.parse(storage.getItem(PROGRESS_STORAGE_KEY) ?? 'null') as Partial<Progress> | null;
    if (!parsed || parsed.version !== 1) return DEFAULT_PROGRESS;
    return {
      version: 1,
      bestQuizScore: Number.isFinite(parsed.bestQuizScore) ? Number(parsed.bestQuizScore) : 0,
      quizAttempts: Number.isFinite(parsed.quizAttempts) ? Number(parsed.quizAttempts) : 0,
      matchedDriverId: typeof parsed.matchedDriverId === 'string' ? parsed.matchedDriverId : null,
      lastPrediction: isPrediction(parsed.lastPrediction) ? parsed.lastPrediction : null,
      predictionStreak: Number.isFinite(parsed.predictionStreak) ? Number(parsed.predictionStreak) : 0,
      bestPredictionScore: Number.isFinite(parsed.bestPredictionScore) ? Number(parsed.bestPredictionScore) : 0,
    };
  } catch {
    return DEFAULT_PROGRESS;
  }
}

export function writeProgress(next: Progress, storage: Storage | null = browserStorage()): void {
  try { storage?.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(next)); } catch { /* blocked or full */ }
}

/** Records a quiz result, keeping the best score. */
export function recordQuizResult(score: number, storage: Storage | null = browserStorage()): Progress {
  const current = readProgress(storage);
  const next: Progress = {
    ...current,
    bestQuizScore: Math.max(current.bestQuizScore, score),
    quizAttempts: current.quizAttempts + 1,
  };
  writeProgress(next, storage);
  return next;
}

function isPrediction(value: unknown): value is PredictionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PredictionRecord>;
  return typeof record.seed === 'string'
    && Array.isArray(record.picks)
    && record.picks.every((pick) => typeof pick === 'string')
    && Number.isFinite(record.score);
}

/**
 * Stores a podium prediction result. The streak counts consecutive predictions
 * that scored anything at all, so a run of near-misses still feels like
 * progress; a blank resets it.
 */
export function recordPrediction(
  record: PredictionRecord,
  storage: Storage | null = browserStorage(),
): Progress {
  const current = readProgress(storage);
  const next: Progress = {
    ...current,
    lastPrediction: record,
    predictionStreak: record.score > 0 ? current.predictionStreak + 1 : 0,
    bestPredictionScore: Math.max(current.bestPredictionScore, record.score),
  };
  writeProgress(next, storage);
  return next;
}

export function recordMatchedDriver(driverId: string, storage: Storage | null = browserStorage()): Progress {
  const next: Progress = { ...readProgress(storage), matchedDriverId: driverId };
  writeProgress(next, storage);
  return next;
}
