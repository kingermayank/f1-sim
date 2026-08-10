import { loadCircuitRuntime, PLAYABLE_CIRCUIT_IDS } from '../../src/track/circuit-registry';

it('loads Shanghai through the same lazy runtime contract used by every circuit', async () => {
  expect(PLAYABLE_CIRCUIT_IDS).toContain('shanghai');
  const runtime = await loadCircuitRuntime('shanghai');
  expect(runtime.id).toBe('shanghai');
  expect(runtime.track.id).toBe('shanghai');
  expect(runtime.laps).toBeGreaterThan(1);
  expect(runtime.assetUrl).toMatch(/shanghai-track\.glb$/);
});
