import { describe, expect, it } from 'vitest';
import { CIRCUITS, PLAYABLE_CIRCUITS, findCircuit } from '../../src/content/circuits';
import { DRIVER_PROFILES } from '../../src/content/driver-profiles';
import { QUIZ_QUESTIONS, explanationFor } from '../../src/content/quiz';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import {
  DEFAULT_PROGRESS, readProgress, recordMatchedDriver, recordQuizResult, writeProgress,
} from '../../src/progress/progress-store';
import { parseHash, routeHref } from '../../src/shell/router';

describe('router', () => {
  it('maps hashes to routes', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/circuits')).toEqual({ name: 'circuits' });
    expect(parseHash('#/circuits/shanghai')).toEqual({ name: 'circuit', param: 'shanghai' });
    expect(parseHash('#/garage')).toEqual({ name: 'garage' });
    expect(parseHash('#/drivers')).toEqual({ name: 'drivers' });
    expect(parseHash('#/learn')).toEqual({ name: 'learn' });
    expect(parseHash('#/race')).toEqual({ name: 'race' });
  });

  it('falls back to home for unknown routes rather than rendering nothing', () => {
    expect(parseHash('#/nonsense')).toEqual({ name: 'home' });
    expect(parseHash('#/circuits/')).toEqual({ name: 'circuits' });
  });

  it('builds hrefs that parse back to the same route', () => {
    expect(parseHash(routeHref('circuits'))).toEqual({ name: 'circuits' });
    expect(parseHash(routeHref('circuit', 'shanghai'))).toEqual({ name: 'circuit', param: 'shanghai' });
    expect(parseHash(routeHref('home'))).toEqual({ name: 'home' });
  });
});

describe('circuit content', () => {
  it('marks exactly the circuits we have actually built as playable', () => {
    expect(PLAYABLE_CIRCUITS.map((circuit) => circuit.id)).toEqual(['shanghai']);
  });

  it('never presents an unbuilt circuit as playable, and gives it no fake outline', () => {
    for (const circuit of CIRCUITS.filter((entry) => entry.status !== 'playable')) {
      expect(circuit.outline, `${circuit.id} must not have a traced outline`).toBeUndefined();
      expect(circuit.corners).toBeUndefined();
    }
  });

  it('traces Shanghai from the simulation centerline', () => {
    const shanghai = findCircuit('shanghai')!;
    expect(shanghai.outline).toMatch(/^M[\d.\s]/);
    expect(shanghai.outline!.endsWith('Z')).toBe(true);
    expect(shanghai.corners!.length).toBeGreaterThanOrEqual(4);
    for (const corner of shanghai.corners!) {
      expect(corner.distance).toBeGreaterThanOrEqual(0);
      expect(corner.distance).toBeLessThan(1);
      expect(corner.note.length).toBeGreaterThan(40);
    }
  });
});

describe('driver profiles', () => {
  it('covers every driver on the grid exactly once', () => {
    expect(DRIVER_PROFILES).toHaveLength(DRIVERS_2026.length);
    const ids = new Set(DRIVER_PROFILES.map((profile) => profile.driverId));
    expect(ids.size).toBe(DRIVERS_2026.length);
    for (const driver of DRIVERS_2026) expect(ids.has(driver.id)).toBe(true);
  });
});

describe('quiz', () => {
  it('has a valid answer index for every question', () => {
    for (const question of QUIZ_QUESTIONS) {
      expect(question.options.length).toBeGreaterThanOrEqual(3);
      expect(question.answer).toBeGreaterThanOrEqual(0);
      expect(question.answer).toBeLessThan(question.options.length);
    }
  });

  it('draws its explanations from the glossary so teaching and testing agree', () => {
    for (const question of QUIZ_QUESTIONS.filter((entry) => entry.term)) {
      expect(explanationFor(question), `${question.id} should resolve a glossary entry`).toBeTruthy();
    }
  });

  it('uses unique question ids', () => {
    expect(new Set(QUIZ_QUESTIONS.map((question) => question.id)).size).toBe(QUIZ_QUESTIONS.length);
  });
});

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    map,
  };
}

describe('progress store', () => {
  it('round-trips progress', () => {
    const storage = memoryStorage();
    recordQuizResult(5, storage);
    expect(readProgress(storage).bestQuizScore).toBe(5);
    expect(readProgress(storage).quizAttempts).toBe(1);
  });

  it('keeps the best score, not the latest', () => {
    const storage = memoryStorage();
    recordQuizResult(7, storage);
    recordQuizResult(2, storage);
    const progress = readProgress(storage);
    expect(progress.bestQuizScore).toBe(7);
    expect(progress.quizAttempts).toBe(2);
  });

  it('remembers a matched driver', () => {
    const storage = memoryStorage();
    recordMatchedDriver('alonso', storage);
    expect(readProgress(storage).matchedDriverId).toBe('alonso');
  });

  it('tolerates corrupt or absent storage instead of throwing', () => {
    const storage = memoryStorage();
    storage.setItem('apex.progress.v1', '{not json');
    expect(readProgress(storage)).toEqual(DEFAULT_PROGRESS);

    storage.setItem('apex.progress.v1', JSON.stringify({ version: 99 }));
    expect(readProgress(storage)).toEqual(DEFAULT_PROGRESS);

    expect(readProgress(null)).toEqual(DEFAULT_PROGRESS);
    expect(() => writeProgress(DEFAULT_PROGRESS, null)).not.toThrow();
  });
});
