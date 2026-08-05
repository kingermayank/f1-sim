import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_RACE_CONFIG } from '../../src/domain/race-config';
import { createDeliveryDiagnostics, installDeliveryDiagnostics } from '../../src/app/delivery-diagnostics';
import { createRaceStore } from '../../src/store/race-store';

beforeEach(() => {
  document.body.innerHTML = '<section class="race-viewport"><canvas></canvas></section>';
  window.history.replaceState(null, '', '/');
  delete window.__MONACO_DIAGNOSTICS__;
});

it('exposes stable race, canvas, effects, and audio delivery diagnostics', () => {
  const store = createRaceStore(DEFAULT_RACE_CONFIG, { storage: null, prefersReducedMotion: false });
  const audio = {
    getDiagnostics: vi.fn(() => ({
      contextState: 'uninitialized' as const,
      ownedNodeCount: 0,
      ownedSourceCount: 0,
      transientNodeCount: 0,
    })),
  };
  const diagnostics = createDeliveryDiagnostics(store, audio);

  expect(diagnostics.snapshot()).toMatchObject({
    seed: DEFAULT_RACE_CONFIG.seed,
    phase: 'grid',
    carCount: 22,
    canvasCount: 1,
    effects: { capacity: { smoke: 32, sparks: 64, debris: 24 }, active: 0 },
    audio: { contextState: 'uninitialized', ownedNodeCount: 0 },
    scenario: {
      activePitCars: 0,
      incidentCount: 0,
      pitEntryCount: 0,
      safetyCarCount: 0,
      safetyCarState: 'none',
    },
  });

  diagnostics.advanceRace(2);
  expect(diagnostics.snapshot().tick).toBeGreaterThan(0);
  diagnostics.restartRace('scenario-0');
  expect(diagnostics.snapshot()).toMatchObject({ seed: 'scenario-0', phase: 'grid', tick: 0 });
  diagnostics.finishRace();
  expect(diagnostics.snapshot()).toMatchObject({ phase: 'finished', carCount: 22 });
  expect(diagnostics.snapshot().scenario).toMatchObject({
    incidentCount: expect.any(Number),
    pitEntryCount: expect.any(Number),
    safetyCarCount: expect.any(Number),
  });
});

it('installs diagnostics only with an explicit development query opt-in', () => {
  const store = createRaceStore(DEFAULT_RACE_CONFIG, { storage: null, prefersReducedMotion: false });
  const audio = { getDiagnostics: () => ({ contextState: 'closed' as const, ownedNodeCount: 0, ownedSourceCount: 0, transientNodeCount: 0 }) };

  expect(installDeliveryDiagnostics(store, audio, false)).toBeUndefined();
  expect(window.__MONACO_DIAGNOSTICS__).toBeUndefined();

  window.history.replaceState(null, '', '/?diagnostics=1');
  const uninstall = installDeliveryDiagnostics(store, audio, true);
  expect(window.__MONACO_DIAGNOSTICS__).toBeDefined();
  uninstall?.();
  expect(window.__MONACO_DIAGNOSTICS__).toBeUndefined();
});
