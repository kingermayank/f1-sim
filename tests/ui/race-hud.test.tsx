import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import { DEFAULT_RACE_CONFIG } from '../../src/domain/race-config';
import { raceStore } from '../../src/store/race-store';
import { RaceHud } from '../../src/ui/RaceHud';
import { driverSpeedKph } from '../../src/ui/DriverPanel';
import { eventKey, EventFeed } from '../../src/ui/EventFeed';
import { Leaderboard } from '../../src/ui/Leaderboard';
import { DriverPanel } from '../../src/ui/DriverPanel';
import type { CarState, RaceState } from '../../src/simulation/events';

describe('RaceHud', () => {
  beforeEach(() => raceStore.getState().restart(DEFAULT_RACE_CONFIG.seed));
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    window.dispatchEvent(new Event('resize'));
  });

  it('converts normalized laps per second to sane kilometers per hour', () => {
    expect(driverSpeedKph(0.02)).toBeCloseTo(240.264, 3);
  });

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
    expect(screen.getByRole('log', { name: 'Race events' })).toHaveAttribute('aria-live', 'off');
    expect(screen.getByRole('region', { name: 'Latest race announcement' })).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('img', { name: 'Monaco circuit position map' })).toBeVisible();
    expect(screen.getAllByTestId('track-map-marker')).toHaveLength(DRIVERS_2026.length);
    expect(screen.getByRole('list', { name: 'Driver track positions' })).toHaveClass('visually-hidden');

    await user.click(screen.getByRole('button', { name: 'Open credits and disclosure' }));
    const credits = screen.getByRole('dialog', { name: 'Credits and disclosure' });
    expect(within(credits).getByText(/generated simulation/i)).toBeVisible();
    expect(within(credits).getAllByRole('link', { name: /license/i }).length).toBeGreaterThan(0);
    expect(within(credits).getByText(/Monaco-inspired Harbor Circuit/i)).toBeVisible();
    expect(within(credits).getByRole('button', { name: 'Close credits' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Credits and disclosure' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open credits and disclosure' })).toHaveFocus();
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

  it('removes the closed mobile timing drawer from keyboard navigation', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    window.dispatchEvent(new Event('resize'));
    const user = userEvent.setup();
    render(<RaceHud />);

    expect(screen.queryByRole('region', { name: 'Race classification' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /follow /i })).toHaveLength(0);
    expect(screen.getByRole('list', { name: 'Driver track positions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle timing tower' })).not.toHaveAttribute('aria-controls');
    await user.click(screen.getByRole('button', { name: 'Toggle timing tower' }));
    expect(screen.getByRole('button', { name: 'Toggle timing tower' })).toHaveAttribute('aria-controls', 'timing-drawer');
    expect(screen.getByRole('region', { name: 'Race classification' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /follow /i })).toHaveLength(22);
  });

  it('announces only a throttled latest event and uses stable event identities', () => {
    const first = { type: 'start' as const, tick: 1 };
    const routine = { type: 'sector' as const, tick: 12, driverId: 'russell', lap: 1, sector: 1 as const, sectorTime: 24 };
    const later = { ...routine, tick: 42, sector: 2 as const };
    const view = render(<EventFeed events={[first]} />);

    expect(screen.getByRole('region', { name: 'Latest race announcement' })).toHaveTextContent(/underway/i);
    expect(screen.getByText('T+0.1s')).toBeVisible();
    view.rerender(<EventFeed events={[first, routine]} />);
    expect(screen.getByRole('region', { name: 'Latest race announcement' })).toHaveTextContent(/underway/i);
    view.rerender(<EventFeed events={[first, routine, later]} />);
    expect(screen.getByRole('region', { name: 'Latest race announcement' })).toHaveTextContent(/sector 2/i);
    expect(eventKey(routine)).toBe(eventKey({ ...routine }));
    expect(eventKey(routine)).not.toBe(eventKey(later));
    expect(screen.getByRole('log', { name: 'Race events' })).toHaveAttribute('aria-live', 'off');
  });

  it('resets the live announcement when a race is replayed or restarted', () => {
    const late = { type: 'sector' as const, tick: 90, driverId: 'russell', lap: 7, sector: 2 as const, sectorTime: 24 };
    const start = { type: 'start' as const, tick: 1 };
    const view = render(<EventFeed raceId="seed-a" events={[late]} />);
    expect(screen.getByRole('region', { name: 'Latest race announcement' })).toHaveTextContent(/sector 2/i);

    view.rerender(<EventFeed raceId="seed-a" events={[]} />);
    expect(screen.getByRole('region', { name: 'Latest race announcement' })).toHaveTextContent(/awaiting race start/i);
    view.rerender(<EventFeed raceId="seed-a" events={[start]} />);
    expect(screen.getByRole('region', { name: 'Latest race announcement' })).toHaveTextContent(/underway/i);

    view.rerender(<EventFeed raceId="seed-b" events={[late]} />);
    expect(screen.getByRole('region', { name: 'Latest race announcement' })).toHaveTextContent(/sector 2/i);
  });

  it('uses terminal timing labels in the leaderboard and selected-driver panel', () => {
    const base = raceStore.getState().snapshot.cars[0];
    const snapshot: RaceState = {
      seed: 'terminal-display', tick: 900, elapsedSeconds: 5406, phase: 'finished', flag: 'green', weather: 'sunny', safetyCar: 'none',
      cars: [
        { ...base, driverId: 'russell', lap: 78, distance: 1, speed: 0, position: 1, status: 'finished', finishPosition: 1, timing: { ...base.timing, totalTime: 5400 } } as CarState,
        { ...base, driverId: 'antonelli', lap: 78, distance: 1, speed: 0, position: 2, status: 'finished', finishPosition: 2, timing: { ...base.timing, totalTime: 5406.25 } } as CarState,
        { ...base, driverId: 'leclerc', lap: 75, distance: .6, speed: 0, position: 3, status: 'retired', retirementTick: 880, timing: { ...base.timing, totalTime: 5200 } } as CarState,
      ],
      events: [{ type: 'retirement', tick: 880, driverId: 'leclerc', reason: 'mechanical' }],
    };
    const view = render(<Leaderboard snapshot={snapshot} selectedDriverId="leclerc" onSelect={() => undefined} />);
    const tower = screen.getByRole('region', { name: 'Race classification' });
    expect(within(tower).getByText('+6.250')).toBeVisible();
    expect(within(tower).getByText(/DNF · Mechanical/i)).toBeVisible();
    expect(within(tower).queryByText('+0.000')).not.toBeInTheDocument();

    view.rerender(<DriverPanel snapshot={snapshot} selectedDriverId="leclerc" />);
    expect(screen.getByText('DNF · Mechanical')).toBeVisible();
  });
});
