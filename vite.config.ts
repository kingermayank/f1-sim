import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // Full-race suites are CPU-heavy and the asset verifier launches a real
    // browser decoder. Serial workers keep their bounded checks deterministic.
    maxWorkers: 1,
  },
});
