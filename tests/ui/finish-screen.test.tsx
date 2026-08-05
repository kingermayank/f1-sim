import { render, screen, within } from '@testing-library/react';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import type { RaceEvent, RaceState } from '../../src/simulation/events';
import { FinishScreen } from '../../src/ui/FinishScreen';

it('presents final classification, race facts, incidents, and replay actions', () => {
  const cars = DRIVERS_2026.map((driver, index) => ({
    driverId: driver.id, lap: 78, distance: 1, lateralOffset: 0, speed: 0,
    tire: { compound: 'hard' as const, wear: 0.7, temperature: 0.5 }, fuelFactor: 0,
    damage: 0, pitState: 'track' as const, pitProgress: 0, position: index + 1,
    timing: { lastLap: 74 + index / 10, bestLap: 72 + index / 10, totalTime: 5400 + index * 4 },
    targetLine: 'racing' as const, status: 'finished' as const, finishPosition: index + 1,
  }));
  const events: RaceEvent[] = [
    { type: 'pit-entry', tick: 20, driverId: cars[0].driverId },
    { type: 'incident', tick: 40, driverIds: [cars[1].driverId], severity: 'minor' },
  ];
  const snapshot: RaceState = {
    seed: 'finish-seed', tick: 1000, elapsedSeconds: 5400, phase: 'finished', flag: 'green', weather: 'sunny',
    safetyCar: 'none', cars, events,
  };

  render(<FinishScreen snapshot={snapshot} onReplay={() => undefined} onNewRace={() => undefined} />);
  expect(screen.getByRole('heading', { name: 'Race complete' })).toBeVisible();
  expect(screen.getByText('finish-seed')).toBeVisible();
  expect(screen.getByText(/Fastest lap/i)).toBeVisible();
  expect(screen.getByText(/1 incident/i)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Replay this seed' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Start with a new seed' })).toBeVisible();
  expect(within(screen.getByRole('table', { name: 'Final classification' })).getAllByRole('row')).toHaveLength(23);
});
