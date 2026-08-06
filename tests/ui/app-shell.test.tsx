import { render, screen } from '@testing-library/react';
import { beforeEach, it, expect } from 'vitest';
import { App } from '../../src/app/App';

// The app now has a landing experience; these assertions cover the race route.
beforeEach(() => { window.location.hash = '#/race'; });

it('renders the race title and loading status', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Shanghai 2026 Simulation' })).toBeVisible();
  expect(screen.getByText('Preparing the grid')).toBeVisible();
});
