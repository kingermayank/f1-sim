import { expect, test, type Page, type TestInfo } from '@playwright/test';

interface BrowserIssueLog {
  consoleErrors: string[];
  pageErrors: string[];
  requestErrors: string[];
}

interface RuntimeSnapshot {
  seed: string;
  phase: 'grid' | 'racing' | 'finished';
  tick: number;
  carCount: number;
  canvasCount: number;
  effects: { capacity: { smoke: number; sparks: number; debris: number }; active: number };
  audio: { contextState: string; ownedNodeCount: number; ownedSourceCount: number; transientNodeCount: number };
}

declare global {
  interface Window {
    __listenerAudit__?: { active(): number };
  }
}

const issuesByPage = new WeakMap<Page, BrowserIssueLog>();

test.beforeEach(async ({ page }) => {
  const issues: BrowserIssueLog = { consoleErrors: [], pageErrors: [], requestErrors: [] };
  issuesByPage.set(page, issues);
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location();
      issues.consoleErrors.push(`${message.text()}${location.url ? ` (${location.url}:${location.lineNumber})` : ''}`);
    }
  });
  page.on('pageerror', (error) => issues.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    issues.requestErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) issues.requestErrors.push(`${response.status()} ${response.url()}`);
  });

  await page.addInitScript(() => {
    let active = 0;
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (...args) {
      active += 1;
      return originalAdd.apply(this, args);
    };
    EventTarget.prototype.removeEventListener = function (...args) {
      active -= 1;
      return originalRemove.apply(this, args);
    };
    window.__listenerAudit__ = { active: () => active };
  });

  await page.goto('/?diagnostics=1');
  await expect(page.getByRole('heading', { name: 'Monaco 2026 Simulation' })).toBeAttached();
  await expect(page.getByRole('region', { name: '3D race viewport' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(/Ready · 22 cars|procedural asset fallback/, { timeout: 20_000 });
  await expect.poll(() => runtime(page).then((snapshot) => snapshot.canvasCount)).toBe(1);
});

test.afterEach(async ({ page }, testInfo) => {
  const issues = issuesByPage.get(page);
  if (!issues) return;
  await testInfo.attach('browser-issues', {
    body: JSON.stringify(issues, null, 2),
    contentType: 'application/json',
  });
  expect(issues, 'browser console/page/request errors').toEqual({
    consoleErrors: [],
    pageErrors: [],
    requestErrors: [],
  });
});

async function runtime(page: Page): Promise<RuntimeSnapshot> {
  return page.evaluate(() => {
    if (!window.__MONACO_DIAGNOSTICS__) throw new Error('Delivery diagnostics were not installed');
    return window.__MONACO_DIAGNOSTICS__.snapshot();
  });
}

async function visibleTimingTower(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name.startsWith('mobile')) {
    const drawer = page.getByRole('button', { name: 'Toggle timing tower' });
    await expect(drawer).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('region', { name: 'Race classification' })).toHaveCount(0);
    await drawer.click();
    await expect(drawer).toHaveAttribute('aria-expanded', 'true');
  }
  return page.getByRole('region', { name: 'Race classification' });
}

async function simulationSeed(page: Page): Promise<string> {
  return runtime(page).then((snapshot) => snapshot.seed);
}

async function measureFrames(page: Page, milliseconds = 2_000) {
  return page.evaluate((duration) => new Promise<{ fps: number; averageMs: number; p95Ms: number; samples: number }>((resolve) => {
    const frameTimes: number[] = [];
    let first = 0;
    let previous = 0;
    const sample = (now: number) => {
      if (first === 0) {
        first = now;
        previous = now;
      } else {
        frameTimes.push(now - previous);
        previous = now;
      }
      if (now - first < duration) requestAnimationFrame(sample);
      else {
        const sorted = [...frameTimes].sort((left, right) => left - right);
        const averageMs = frameTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, frameTimes.length);
        resolve({
          fps: 1_000 / averageMs,
          averageMs,
          p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
          samples: frameTimes.length,
        });
      }
    };
    requestAnimationFrame(sample);
  }), milliseconds);
}

test('loads 22 drivers and supports following, cameras, pause, speeds, seeds, and credits', async ({ page }, testInfo) => {
  const tower = await visibleTimingTower(page, testInfo);
  const followButtons = tower.getByRole('button', { name: /^Follow / });
  await expect(followButtons).toHaveCount(22);
  await expect(page.locator('[data-driver-id]')).toHaveCount(22);

  const followKimi = tower.getByRole('button', { name: 'Follow Kimi Antonelli' });
  await followKimi.click();
  await expect(page.getByRole('heading', { name: 'Kimi Antonelli' })).toBeVisible();
  if (!testInfo.project.name.startsWith('mobile')) await expect(followKimi).toHaveAttribute('aria-current', 'true');
  await page.locator('[data-driver-id="antonelli"]').click({ force: true });
  await expect(page.locator('[data-driver-id="antonelli"]')).toHaveAttribute('aria-pressed', 'true');

  for (const camera of ['Broadcast', 'Chase', 'Cockpit', 'Overhead', 'Free']) {
    const button = page.getByRole('button', { name: `${camera} camera` });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }

  const pause = page.getByRole('button', { name: 'Pause race' });
  await pause.click();
  await expect(page.getByRole('button', { name: 'Resume race' })).toHaveAttribute('aria-pressed', 'true');
  const pausedTick = (await runtime(page)).tick;
  await page.waitForTimeout(250);
  expect((await runtime(page)).tick).toBe(pausedTick);
  await page.getByRole('button', { name: 'Resume race' }).click();

  for (const speed of ['1', '2', '4', '8']) {
    await page.getByLabel('Simulation speed').selectOption(speed);
    await expect(page.getByLabel('Simulation speed')).toHaveValue(speed);
  }

  const originalSeed = await simulationSeed(page);
  await page.evaluate(() => window.__MONACO_DIAGNOSTICS__!.advanceRace(30));
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Replay seed' }).click();
  await expect(page.getByLabel('Current lap')).toContainText('Lap 1 / 78');
  expect(await simulationSeed(page)).toBe(originalSeed);

  await page.getByRole('button', { name: 'Restart race' }).click();
  expect(await simulationSeed(page)).toBe(originalSeed);
  await page.getByRole('button', { name: 'New race seed' }).click();
  await expect.poll(() => simulationSeed(page)).not.toBe(originalSeed);

  await page.getByRole('button', { name: /Open credits and disclosure/ }).first().click();
  const credits = page.getByRole('dialog', { name: 'Credits and disclosure' });
  await expect(credits).toBeVisible();
  await expect(credits.getByText('Independent simulated broadcast')).toBeVisible();
  await expect(credits.getByRole('link', { name: /license/i })).toHaveCount(13);
  await page.keyboard.press('Escape');
  await expect(credits).toHaveCount(0);

  if (testInfo.project.name.startsWith('mobile')) {
    await expect(page.getByRole('img', { name: 'Monaco circuit position map' })).toBeAttached();
    await expect(page.getByRole('list', { name: 'Driver track positions' })).toBeAttached();
    await expect(page.getByTestId('track-map-marker')).toHaveCount(22);
  }
});

test('persists preferences across reloads', async ({ page }) => {
  await page.getByRole('button', { name: 'Hide car labels' }).click();
  await page.getByRole('button', { name: 'Disable race effects' }).click();
  await page.getByRole('button', { name: 'Enable reduced motion' }).click();
  await page.getByRole('button', { name: 'Cockpit camera' }).click();
  await page.getByLabel('Scene detail').selectOption('mobile');
  await page.reload();
  await expect(page.getByRole('status')).toContainText(/Ready · 22 cars|procedural asset fallback/, { timeout: 20_000 });

  await expect(page.getByRole('button', { name: 'Show car labels' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Enable race effects' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Disable reduced motion' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Cockpit camera' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Scene detail')).toHaveValue('mobile');
});

test('finishes quickly through the diagnostics boundary and exposes replay actions', async ({ page }) => {
  await page.evaluate(() => window.__MONACO_DIAGNOSTICS__!.finishRace());
  const finish = page.getByRole('dialog', { name: 'Race complete' });
  await expect(finish).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Current lap')).toContainText('Lap 78 / 78');
  await expect(finish.getByRole('table', { name: 'Final classification' }).getByRole('row')).toHaveCount(23);

  const seed = await simulationSeed(page);
  await finish.getByRole('button', { name: 'Replay this seed' }).click();
  await expect(finish).toHaveCount(0);
  await expect(page.getByLabel('Current lap')).toContainText('Lap 1 / 78');
  expect(await simulationSeed(page)).toBe(seed);

  await page.evaluate(() => window.__MONACO_DIAGNOSTICS__!.finishRace());
  await page.getByRole('button', { name: 'Start with a new seed' }).click();
  await expect.poll(() => simulationSeed(page)).not.toBe(seed);
});

test('keeps canvas, listeners, audio, and effect pools steady over five restarts and records frame timing', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Unmute audio' }).click();
  await expect.poll(() => runtime(page).then((value) => value.audio.contextState)).toBe('running');
  await page.getByRole('button', { name: 'Pause race' }).click();
  const baseline = await runtime(page);
  const listenerBaseline = await page.evaluate(() => window.__listenerAudit__!.active());
  expect(baseline).toMatchObject({
    carCount: 22,
    canvasCount: 1,
    effects: { capacity: { smoke: 32, sparks: 64, debris: 24 }, active: 0 },
    audio: { contextState: 'running', ownedNodeCount: 10, ownedSourceCount: 4, transientNodeCount: 0 },
  });

  for (let restart = 0; restart < 5; restart += 1) {
    await page.getByRole('button', { name: 'Restart race' }).click();
    await page.getByRole('button', { name: 'Pause race' }).click();
    await expect(page.getByLabel('Current lap')).toContainText('Lap 1 / 78');
    await expect.poll(() => runtime(page).then((value) => value.canvasCount)).toBe(1);
    const current = await runtime(page);
    expect(current.effects).toEqual(baseline.effects);
    expect(current.audio).toEqual(baseline.audio);
    expect(await page.evaluate(() => window.__listenerAudit__!.active())).toBe(listenerBaseline);
  }

  await page.getByRole('button', { name: 'Resume race' }).click();
  const start = await measureFrames(page);
  await page.evaluate(() => window.__MONACO_DIAGNOSTICS__!.advanceRace(150));
  const advanced = await measureFrames(page);
  const target = testInfo.project.name.startsWith('mobile') ? 30 : 60;
  console.log(`PERF ${testInfo.project.name} start=${start.fps.toFixed(1)}fps/${start.p95Ms.toFixed(1)}ms-p95 advanced=${advanced.fps.toFixed(1)}fps/${advanced.p95Ms.toFixed(1)}ms-p95`);
  expect(start.fps).toBeGreaterThanOrEqual(target * 0.85);
  expect(advanced.fps).toBeGreaterThanOrEqual(target * 0.85);
});
