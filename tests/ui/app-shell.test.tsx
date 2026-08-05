import { render, screen } from '@testing-library/react';
import { App } from '../../src/app/App';

it('renders the race title and loading status', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Shanghai 2026 Simulation' })).toBeVisible();
  expect(screen.getByText('Preparing the grid')).toBeVisible();
});
