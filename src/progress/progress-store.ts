/**
 * Local-only progress. No accounts, no backend, no cross-device sync — a
 * deliberate product decision to keep signup friction at zero.
 *
 * Every read is defensive: storage can be disabled, full, or contain data
 * written by an older version, and none of those should break the page.
 */
export const PROGRESS_STORAGE_KEY = 'apex.progress.v1';

export interface Progress {
  version: 1;
  /** Best quiz score so far, out of the number of questions answered. */
  bestQuizScore: number;
  quizAttempts: number;
  /** Driver id chosen by Find My Driver. */
  matchedDriverId: string | null;
}

export const DEFAULT_PROGRESS: Progress = {
  version: 1,
  bestQuizScore: 0,
  quizAttempts: 0,
  matchedDriverId: null,
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

export function recordMatchedDriver(driverId: string, storage: Storage | null = browserStorage()): Progress {
  const next: Progress = { ...readProgress(storage), matchedDriverId: driverId };
  writeProgress(next, storage);
  return next;
}
