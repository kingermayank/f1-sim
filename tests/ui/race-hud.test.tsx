import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
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
import { raceAudioController } from '../../src/audio/race-audio';

describe('RaceHud', () => {
  beforeEach(() => raceStore.getState().restart(DEFAULT_RACE_CONFIG.seed));
  afterEach(() => {
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
      window.dispatchEvent(new Event('resize'));
    });
  });

  it('converts normalized laps per second to sane kilometers per hour', () => {
    expect(driverSpeedKph(0.02)).toBeCloseTo(384.48, 3);
  });

  it('shows complete timing for all 14 drivers and selects a driver', async () => {
    const user = userEvent.setup();
    render(<RaceHud />);

    const tower = screen.getByRole('region', { name: 'Race classification' });
    expect(within(tower).getAllByRole('button', { name: /follow /i })).toHaveLength(14);
    expect(within(tower).getByText('LEC')).toBeVisible();
    expect(within(tower).getAllByText(/soft|medium|hard/i).length).toBeGreaterThan(0);

    await user.click(within(tower).getByRole('button', { name: /follow lewis hamilton/i }));
    expect(screen.getByRole('heading', { name: /lewis hamilton/i })).toBeVisible();
    expect(within(tower).getByRole('button', { name: /follow lewis hamilton/i })).toHaveAttribute('aria-current', 'true');
  });

  it('changes speed, camera, presentation preferences, and mobile drawer state', async () => {
    const user = userEvent.setup();
    const resumeAudio = vi.spyOn(raceAudioController, 'resume').mockResolvedValue(true);
    render(<RaceHud />);

    expect(screen.getByLabelText('Simulation speed')).toHaveDisplayValue('1×');
    expect(screen.getByRole('option', { name: '0.25×' })).toHaveValue('0.25');
    expect(screen.getByRole('option', { name: '0.5×' })).toHaveValue('0.5');
    await user.selectOptions(screen.getByLabelText('Simulation speed'), '0.25');
    expect(screen.getByLabelText('Simulation speed')).toHaveValue('0.25');
    expect(screen.getByLabelText('Playback speed')).toHaveTextContent('0.25×');
    await user.selectOptions(screen.getByLabelText('Simulation speed'), '4');
    expect(screen.getByLabelText('Simulation speed')).toHaveValue('4');

    for (const camera of ['Broadcast', 'Chase', 'Cockpit', 'Overhead', 'Free']) {
      expect(screen.getByRole('button', { name: `${camera} camera` })).toBeVisible();
    }
    await user.click(screen.getByRole('button', { name: 'Cockpit camera' }));
    expect(screen.getByRole('button', { name: 'Cockpit camera' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Open more race information and preferences' }));
    await user.click(screen.getByRole('button', { name: 'Hide car labels' }));
    await user.click(screen.getByRole('button', { name: 'Disable race effects' }));
    await user.click(screen.getByRole('button', { name: 'Unmute audio' }));
    await user.click(screen.getByRole('button', { name: 'Enable reduced motion' }));
    expect(screen.getByRole('button', { name: 'Show car labels' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Enable race effects' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Mute audio' })).toHaveAttribute('aria-pressed', 'false');
    expect(resumeAudio).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Disable reduced motion' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Close more race information' }));

    const drawer = screen.getByRole('button', { name: 'Toggle timing tower' });
    expect(drawer).toHaveAttribute('aria-expanded', 'false');
    await user.click(drawer);
    expect(drawer).toHaveAttribute('aria-expanded', 'true');
    resumeAudio.mockRestore();
  });

  it('exposes race context, an accessible live feed, track markers, credits, and disclosure', async () => {
    const user = userEvent.setup();
    render(<RaceHud />);

    expect(screen.getByLabelText(/race flag/i)).toHaveTextContent('Green');
    expect(screen.getByLabelText('Current lap')).toHaveTextContent('Lap 1 / 20');
    expect(screen.getByLabelText('Simulation seed')).toHaveTextContent(DEFAULT_RACE_CONFIG.seed);
    await user.click(screen.getByRole('button', { name: 'Open more race information and preferences' }));
    const more = screen.getByRole('dialog', { name: 'More race information' });
    expect(within(more).getByRole('log', { name: 'Race events' })).toHaveAttribute('aria-live', 'off');
    expect(within(more).getByRole('region', { name: 'Latest race announcement' })).toHaveAttribute('aria-live', 'polite');
    expect(within(more).getByRole('img', { name: 'Shanghai circuit position map' })).toBeVisible();
    expect(screen.getAllByTestId('track-map-marker')).toHaveLength(DRIVERS_2026.length);
    expect(screen.getByRole('list', { name: 'Driver track positions' })).toHaveClass('visually-hidden');
    await user.click(within(more).getByRole('button', { name: 'Close more race information' }));

    await user.click(screen.getByRole('button', { name: 'Open credits and disclosure' }));
    const credits = screen.getByRole('dialog', { name: 'Credits and disclosure' });
    expect(within(credits).getByText(/generated simulation/i)).toBeVisible();
    expect(within(credits).getAllByRole('link', { name: /license/i }).length).toBeGreaterThan(0);
    expect(within(credits).getByText(/Shanghai International Circuit/i)).toBeVisible();
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
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
      window.dispatchEvent(new Event('resize'));
    });
    const user = userEvent.setup();
    render(<RaceHud />);

    expect(screen.queryByRole('region', { name: 'Race classification' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /follow /i })).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Open more race information and preferences' })).toBeInTheDocument();
    const timingToggle = screen.getByRole('button', { name: 'Toggle timing tower' });
    expect(timingToggle).not.toHaveAttribute('aria-controls');
    await user.click(timingToggle);
    expect(timingToggle).toHaveAttribute('aria-controls', 'timing-drawer');
    expect(screen.getByRole('region', { name: 'Race classification' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /follow /i })).toHaveLength(14);
    expect(screen.getByRole('button', { name: 'Close timing tower' })).toBeVisible();
    expect(document.querySelector('.race-hud__right')).toHaveAttribute('aria-hidden', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Race classification' })).not.toBeInTheDocument();
    expect(timingToggle).toHaveFocus();
    expect(document.querySelector('.race-hud__right')).not.toHaveAttribute('aria-hidden');
  });

  it('shows elapsed time, playback speed, leader, sectors, strategy, condition, and fastest lap', () => {
    const state = raceStore.getState();
    const leclerc = state.snapshot.cars.find((car) => car.driverId === 'leclerc')!;
    const hamilton = state.snapshot.cars.find((car) => car.driverId === 'hamilton')!;
    const snapshot: RaceState = {
      ...state.snapshot,
      tick: 905,
      elapsedSeconds: 90.5,
      cars: [
        { ...leclerc, position: 1, damage: 0.4, tire: { ...leclerc.tire, compound: 'soft' }, timing: { ...leclerc.timing, bestLap: 71.25 } },
        { ...hamilton, position: 2, timing: { ...hamilton.timing, bestLap: 72.5 } },
      ],
      events: [
        { type: 'sector', tick: 600, driverId: 'leclerc', lap: 4, sector: 1, sectorTime: 22.111 },
        { type: 'sector', tick: 610, driverId: 'leclerc', lap: 4, sector: 2, sectorTime: 24.222 },
        { type: 'sector', tick: 620, driverId: 'leclerc', lap: 4, sector: 3, sectorTime: 25.333 },
        { type: 'pit-entry', tick: 700, driverId: 'leclerc' },
        { type: 'tire-change', tick: 710, driverId: 'leclerc', compound: 'soft' },
        { type: 'pit-exit', tick: 720, driverId: 'leclerc' },
      ],
    };
    raceStore.setState({ snapshot: Object.freeze(snapshot), eventFeed: Object.freeze(snapshot.events), selectedDriverId: 'leclerc', speed: 4 });

    render(<RaceHud />);

    expect(screen.getByLabelText('Elapsed simulation time')).toHaveTextContent('1:30.500');
    expect(screen.getByLabelText('Playback speed')).toHaveTextContent('4×');
    expect(screen.getByLabelText('Race leader')).toHaveTextContent('Charles Leclerc');
    expect(screen.getByText('22.111')).toBeVisible();
    expect(screen.getByText('24.222')).toBeVisible();
    expect(screen.getByText('25.333')).toBeVisible();
    expect(screen.getByText(/1 stop · Soft stint/i)).toBeVisible();
    expect(screen.getByText(/Moderate · 40% damage/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /follow charles leclerc.*fastest lap/i })).toBeVisible();
    expect(screen.getByText('S', { selector: '.tire' })).toHaveAccessibleName(/Soft tire/i);
  });

  it('moves secondary information and preferences into More below 1200px', async () => {
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
      window.dispatchEvent(new Event('resize'));
    });
    const user = userEvent.setup();
    render(<RaceHud />);

    expect(screen.queryByRole('img', { name: 'Shanghai circuit position map' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide car labels' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open more race information and preferences' }));
    const dialog = screen.getByRole('dialog', { name: 'More race information' });
    expect(within(dialog).getByRole('img', { name: 'Shanghai circuit position map' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: /(?:hide|show) car labels/i })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Close more race information' })).toHaveFocus();
  });

  it('announces only a throttled latest event and uses stable event identities', () => {
    const first = { type: 'start' as const, tick: 1 };
    const routine = { type: 'sector' as const, tick: 12, driverId: 'leclerc', lap: 1, sector: 1 as const, sectorTime: 24 };
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
    const late = { type: 'sector' as const, tick: 90, driverId: 'leclerc', lap: 7, sector: 2 as const, sectorTime: 24 };
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
        { ...base, driverId: 'leclerc', lap: 56, distance: 1, speed: 0, position: 1, status: 'finished', finishPosition: 1, timing: { ...base.timing, totalTime: 5400 } } as CarState,
        { ...base, driverId: 'hamilton', lap: 56, distance: 1, speed: 0, position: 2, status: 'finished', finishPosition: 2, timing: { ...base.timing, totalTime: 5406.25 } } as CarState,
        { ...base, driverId: 'alonso', lap: 53, distance: .6, speed: 0, position: 3, status: 'retired', retirementTick: 880, timing: { ...base.timing, totalTime: 5200 } } as CarState,
      ],
      events: [{ type: 'retirement', tick: 880, driverId: 'alonso', reason: 'mechanical' }],
    };
    const view = render(<Leaderboard snapshot={snapshot} selectedDriverId="leclerc" onSelect={() => undefined} />);
    const tower = screen.getByRole('region', { name: 'Race classification' });
    expect(within(tower).getByText('+6.250')).toBeVisible();
    expect(within(tower).getByText(/DNF · Mechanical/i)).toBeVisible();
    expect(within(tower).queryByText('+0.000')).not.toBeInTheDocument();

    view.rerender(<DriverPanel snapshot={snapshot} selectedDriverId="alonso" />);
    expect(screen.getByText('DNF · Mechanical')).toBeVisible();
  });
});
