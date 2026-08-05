import { existsSync } from 'node:fs';
import { chromium, defineConfig } from '@playwright/test';

const bundledChromium = chromium.executablePath();
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const requestedExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const executablePath = existsSync(bundledChromium)
  ? undefined
  : requestedExecutable && existsSync(requestedExecutable) ? requestedExecutable
    : existsSync(systemChrome) ? systemChrome : undefined;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    launchOptions: { executablePath },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
