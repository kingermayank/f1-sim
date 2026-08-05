import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import type { RaceEvent, RaceState } from '../../src/simulation/events';
import { FinishScreen } from '../../src/ui/FinishScreen';

it('presents final classification, race facts, incidents, and replay actions', () => {
  const cars = DRIVERS_2026.map((driver, index) => ({
    driverId: driver.id, lap: 56, distance: 1, lateralOffset: 0, speed: 0,
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
  const recap = screen.getByRole('list', { name: 'Incident recap' });
  expect(within(recap).getByText(/Minor incident/i)).toBeVisible();
  expect(within(recap).getByText(new RegExp(DRIVERS_2026[1].name, 'i'))).toBeVisible();
  expect(within(recap).getByText(/T\+4\.0s/i)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Replay this seed' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Start with a new seed' })).toBeVisible();
  expect(within(screen.getByRole('table', { name: 'Final classification' })).getAllByRole('row')).toHaveLength(15);
});

it('uses official finish-time gaps and lap deficits for retired drivers', () => {
  const finisher = {
    driverId: 'verstappen', lap: 56, distance: 1, lateralOffset: 0, speed: 0,
    tire: { compound: 'hard' as const, wear: 0.7, temperature: 0.5 }, fuelFactor: 0,
    damage: 0, pitState: 'track' as const, pitProgress: 0, position: 1,
    timing: { lastLap: 74, bestLap: 72, totalTime: 5400 }, targetLine: 'racing' as const,
    status: 'finished' as const, finishPosition: 1,
  };
  const snapshot: RaceState = {
    seed: 'classified-seed', tick: 1000, elapsedSeconds: 5400, phase: 'finished', flag: 'green', weather: 'sunny', safetyCar: 'none',
    cars: [
      finisher,
      { ...finisher, driverId: 'hadjar', position: 2, finishPosition: 2, timing: { ...finisher.timing, totalTime: 5406.25 } },
      { ...finisher, driverId: 'leclerc', lap: 53, distance: 0.6, position: 3, speed: 0, status: 'retired' as const, finishPosition: undefined as never, retirementTick: 900 },
    ],
    events: [{ type: 'retirement', tick: 900, driverId: 'leclerc', reason: 'mechanical' }],
  };
  render(<FinishScreen snapshot={snapshot} onReplay={() => undefined} onNewRace={() => undefined} />);
  const table = screen.getByRole('table', { name: 'Final classification' });
  expect(within(table).getByText('+6.250')).toBeVisible();
  expect(within(table).getByText('+3 laps')).toBeVisible();
  expect(within(table).getByText('DNF · Mechanical')).toBeVisible();
});

it('moves focus into the finish modal, traps it, closes on Escape, and restores focus', async () => {
  const user = userEvent.setup();
  const launcher = document.createElement('button');
  launcher.textContent = 'Launch';
  document.body.append(launcher);
  launcher.focus();
  const snapshot: RaceState = {
    seed: 'empty-finish', tick: 0, elapsedSeconds: 0, phase: 'finished', flag: 'green', weather: 'sunny', safetyCar: 'none', cars: [], events: [],
  };
  render(<FinishScreen snapshot={snapshot} onReplay={() => undefined} onNewRace={() => undefined} />);
  expect(screen.getByRole('dialog', { name: 'Race complete' })).toContainElement(document.activeElement as HTMLElement);
  await user.keyboard('{Shift>}{Tab}{/Shift}');
  expect(screen.getByRole('button', { name: 'Start with a new seed' })).toHaveFocus();
  await user.keyboard('{Tab}');
  expect(screen.getByRole('button', { name: 'Replay this seed' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: 'Race complete' })).not.toBeInTheDocument();
  expect(launcher).toHaveFocus();
  launcher.remove();
});
