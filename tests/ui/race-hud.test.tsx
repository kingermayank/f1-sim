import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import { DEFAULT_RACE_CONFIG } from '../../src/domain/race-config';
import { raceStore } from '../../src/store/race-store';
import { RaceHud } from '../../src/ui/RaceHud';

describe('RaceHud', () => {
  beforeEach(() => raceStore.getState().restart(DEFAULT_RACE_CONFIG.seed));

  it('shows complete timing for all 22 drivers and selects a driver', async () => {
    const user = userEvent.setup();
    render(<RaceHud />);

    const tower = screen.getByRole('region', { name: 'Race classification' });
    expect(within(tower).getAllByRole('button', { name: /follow /i })).toHaveLength(22);
    expect(within(tower).getByText('RUS')).toBeVisible();
    expect(within(tower).getAllByText(/soft|medium|hard/i).length).toBeGreaterThan(0);

    await user.click(within(tower).getByRole('button', { name: /follow kimi antonelli/i }));
    expect(screen.getByRole('heading', { name: /kimi antonelli/i })).toBeVisible();
    expect(within(tower).getByRole('button', { name: /follow kimi antonelli/i })).toHaveAttribute('aria-current', 'true');
  });

  it('changes speed, camera, presentation preferences, and mobile drawer state', async () => {
    const user = userEvent.setup();
    render(<RaceHud />);

    await user.selectOptions(screen.getByLabelText('Simulation speed'), '4');
    expect(screen.getByLabelText('Simulation speed')).toHaveValue('4');

    for (const camera of ['Broadcast', 'Chase', 'Cockpit', 'Overhead', 'Free']) {
      expect(screen.getByRole('button', { name: `${camera} camera` })).toBeVisible();
    }
    await user.click(screen.getByRole('button', { name: 'Cockpit camera' }));
    expect(screen.getByRole('button', { name: 'Cockpit camera' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Hide car labels' }));
    await user.click(screen.getByRole('button', { name: 'Disable race effects' }));
    await user.click(screen.getByRole('button', { name: 'Mute audio' }));
    await user.click(screen.getByRole('button', { name: 'Enable reduced motion' }));
    expect(screen.getByRole('button', { name: 'Show car labels' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Enable race effects' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Unmute audio' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Disable reduced motion' })).toHaveAttribute('aria-pressed', 'true');

    const drawer = screen.getByRole('button', { name: 'Toggle timing tower' });
    expect(drawer).toHaveAttribute('aria-expanded', 'false');
    await user.click(drawer);
    expect(drawer).toHaveAttribute('aria-expanded', 'true');
  });

  it('exposes race context, an accessible live feed, track markers, credits, and disclosure', async () => {
    const user = userEvent.setup();
    render(<RaceHud />);

    expect(screen.getByLabelText(/race flag/i)).toHaveTextContent('Green');
    expect(screen.getByText(/Lap 1 \/ 78/i)).toBeVisible();
    expect(screen.getByText(DEFAULT_RACE_CONFIG.seed)).toBeVisible();
    expect(screen.getByRole('log', { name: 'Race events' })).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('img', { name: 'Monaco circuit position map' })).toBeVisible();
    expect(screen.getAllByTestId('track-map-marker')).toHaveLength(DRIVERS_2026.length);
    expect(screen.getByRole('list', { name: 'Driver track positions' })).toHaveClass('visually-hidden');

    await user.click(screen.getByRole('button', { name: 'Open credits and disclosure' }));
    const credits = screen.getByRole('dialog', { name: 'Credits and disclosure' });
    expect(within(credits).getByText(/generated simulation/i)).toBeVisible();
    expect(within(credits).getAllByRole('link', { name: /license/i }).length).toBeGreaterThan(0);
    expect(within(credits).getByText(/Monaco-inspired Harbor Circuit/i)).toBeVisible();
  });

  it('requires confirmation before restarting an active race after lap one', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const state = raceStore.getState();
    raceStore.setState({
      snapshot: Object.freeze({
        ...state.snapshot,
        phase: 'racing',
        cars: Object.freeze(state.snapshot.cars.map((car, index) => Object.freeze({ ...car, lap: index === 0 ? 2 : car.lap }))),
      }),
    });
    render(<RaceHud />);

    await user.click(screen.getByRole('button', { name: 'Restart race' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(raceStore.getState().snapshot.cars[0].lap).toBe(2);
    confirm.mockRestore();
  });
});
