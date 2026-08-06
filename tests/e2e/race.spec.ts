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
  scenario: {
    activePitCars: number;
    incidentCount: number;
    pitEntryCount: number;
    safetyCarCount: number;
    safetyCarState: string;
  };
  renderer: {
    buffers: number;
    textures: number;
    programs: number;
    framebuffers: number;
    renderbuffers: number;
    drawCalls: number;
  };
  failedAssetUrls: string[];
}

declare global {
  interface Window {
    __listenerAudit__?: { active(): number };
    __deliveryAudit__?: {
      resetDrawCalls(): void;
      snapshot(): Pick<RuntimeSnapshot, 'renderer' | 'failedAssetUrls'>;
    };
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
    const windowListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    const failedAssetUrls = new Set<string>();
    const renderer = {
      buffers: 0,
      textures: 0,
      programs: 0,
      framebuffers: 0,
      renderbuffers: 0,
      drawCalls: 0,
    };
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (...args) {
      const [type, listener, options] = args;
      if (this === window && listener) {
        const capture = typeof options === 'boolean' ? options : options?.capture === true;
        const key = `${type}:${capture}`;
        const listeners = windowListeners.get(key) ?? new Set<EventListenerOrEventListenerObject>();
        if (!listeners.has(listener)) {
          listeners.add(listener);
          windowListeners.set(key, listeners);
          active += 1;
        }
      }
      return originalAdd.apply(this, args);
    };
    EventTarget.prototype.removeEventListener = function (...args) {
      const [type, listener, options] = args;
      if (this === window && listener) {
        const capture = typeof options === 'boolean' ? options : options?.capture === true;
        const key = `${type}:${capture}`;
        const listeners = windowListeners.get(key);
        if (listeners?.delete(listener)) active -= 1;
        if (listeners?.size === 0) windowListeners.delete(key);
      }
      return originalRemove.apply(this, args);
    };
    window.__listenerAudit__ = { active: () => active };

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const requestUrl = typeof args[0] === 'string' ? args[0]
        : args[0] instanceof URL ? args[0].href : args[0].url;
      try {
        const response = await originalFetch(...args);
        if (!response.ok && requestUrl.includes('/assets/')) failedAssetUrls.add(new URL(requestUrl, location.href).href);
        return response;
      } catch (error) {
        if (requestUrl.includes('/assets/')) failedAssetUrls.add(new URL(requestUrl, location.href).href);
        throw error;
      }
    };

    type ResourceKey = 'buffers' | 'textures' | 'programs' | 'framebuffers' | 'renderbuffers';
    const tracked: Record<ResourceKey, WeakSet<object>> = {
      buffers: new WeakSet(),
      textures: new WeakSet(),
      programs: new WeakSet(),
      framebuffers: new WeakSet(),
      renderbuffers: new WeakSet(),
    };
    const patchResources = (
      prototype: object,
      createName: string,
      deleteName: string,
      key: ResourceKey,
    ) => {
      if (!Object.prototype.hasOwnProperty.call(prototype, createName)) return;
      const record = prototype as Record<string, (...args: unknown[]) => unknown>;
      const create = record[createName];
      const remove = record[deleteName];
      if (typeof create !== 'function' || typeof remove !== 'function') return;
      record[createName] = function (...args: unknown[]) {
        const resource = create.apply(this, args);
        if (resource && typeof resource === 'object' && !tracked[key].has(resource)) {
          tracked[key].add(resource);
          renderer[key] += 1;
        }
        return resource;
      };
      record[deleteName] = function (...args: unknown[]) {
        const resource = args[0];
        if (resource && typeof resource === 'object' && tracked[key].has(resource)) {
          tracked[key].delete(resource);
          renderer[key] -= 1;
        }
        return remove.apply(this, args);
      };
    };
    const patchDraw = (prototype: object, methodName: string) => {
      if (!Object.prototype.hasOwnProperty.call(prototype, methodName)) return;
      const record = prototype as Record<string, (...args: unknown[]) => unknown>;
      const draw = record[methodName];
      if (typeof draw !== 'function') return;
      record[methodName] = function (...args: unknown[]) {
        renderer.drawCalls += 1;
        return draw.apply(this, args);
      };
    };
    const prototypes = [
      globalThis.WebGLRenderingContext?.prototype,
      globalThis.WebGL2RenderingContext?.prototype,
    ].filter(Boolean) as object[];
    for (const prototype of prototypes) {
      patchResources(prototype, 'createBuffer', 'deleteBuffer', 'buffers');
      patchResources(prototype, 'createTexture', 'deleteTexture', 'textures');
      patchResources(prototype, 'createProgram', 'deleteProgram', 'programs');
      patchResources(prototype, 'createFramebuffer', 'deleteFramebuffer', 'framebuffers');
      patchResources(prototype, 'createRenderbuffer', 'deleteRenderbuffer', 'renderbuffers');
      for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
        patchDraw(prototype, method);
      }
    }
    window.__deliveryAudit__ = {
      resetDrawCalls: () => { renderer.drawCalls = 0; },
      snapshot: () => ({
        renderer: { ...renderer },
        failedAssetUrls: [...failedAssetUrls],
      }),
    };
  });

  await page.goto('/?diagnostics=1#/race');
  await expect(page.getByRole('heading', { name: 'Shanghai 2026 Simulation' })).toBeAttached();
  await expect(page.getByRole('region', { name: '3D race viewport' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Ready · 14 cars on the Shanghai circuit', { timeout: 20_000 });
  await expect.poll(() => runtime(page).then((snapshot) => snapshot.canvasCount)).toBe(1);
  await expect.poll(() => runtime(page).then((snapshot) => snapshot.failedAssetUrls)).toEqual([]);
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
    if (!window.__RACE_DIAGNOSTICS__) throw new Error('Delivery diagnostics were not installed');
    if (!window.__deliveryAudit__) throw new Error('Browser delivery audit was not installed');
    return { ...window.__RACE_DIAGNOSTICS__.snapshot(), ...window.__deliveryAudit__.snapshot() };
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

async function openMorePanel(page: Page, testInfo: TestInfo) {
  if (!testInfo.project.name.startsWith('mobile')) return;
  await page.getByRole('button', { name: 'Open more race information and preferences' }).click();
  await expect(page.getByRole('dialog', { name: 'More race information' })).toBeVisible();
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

test('loads 14 drivers and supports following, cameras, pause, speeds, seeds, and credits', async ({ page }, testInfo) => {
  await page.evaluate(() => window.__RACE_DIAGNOSTICS__!.restartRace('e2e-ui-matrix'));
  await page.getByRole('button', { name: 'Pause race' }).click();
  await expect(page.getByRole('button', { name: 'Resume race' })).toHaveAttribute('aria-pressed', 'true');
  const pausedTick = (await runtime(page)).tick;
  await page.waitForTimeout(250);
  expect((await runtime(page)).tick).toBe(pausedTick);

  const tower = await visibleTimingTower(page, testInfo);
  const followButtons = tower.getByRole('button', { name: /^Follow / });
  await expect(followButtons).toHaveCount(14);
  const driverControls = page.locator('[data-driver-id]');
  await expect(driverControls).toHaveCount(14);
  const followLabels = await followButtons.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')!));

  for (const followLabel of followLabels) {
    if (testInfo.project.name.startsWith('mobile') && await page.getByRole('region', { name: 'Race classification' }).count() === 0) {
      await page.getByRole('button', { name: 'Toggle timing tower' }).click();
    }
    const currentTower = page.getByRole('region', { name: 'Race classification' });
    const driverName = followLabel.replace(/^Follow /, '').replace(/, fastest lap$/, '');
    const follow = currentTower.getByRole('button', { name: new RegExp(`^Follow ${driverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:, fastest lap)?$`) });
    await follow.click();
    await expect(page.getByRole('heading', { name: driverName!, exact: true })).toBeVisible();
    if (!testInfo.project.name.startsWith('mobile')) await expect(follow).toHaveAttribute('aria-current', 'true');
  }

  if (testInfo.project.name.startsWith('mobile')) await page.getByRole('button', { name: 'Toggle timing tower' }).click();
  const currentTower = page.getByRole('region', { name: 'Race classification' });
  const followKimi = currentTower.getByRole('button', { name: 'Follow Lewis Hamilton' });
  await followKimi.click();
  await expect(page.getByRole('heading', { name: 'Lewis Hamilton' })).toBeVisible();
  if (!testInfo.project.name.startsWith('mobile')) await expect(followKimi).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-driver-id="hamilton"]')).toHaveAttribute('aria-pressed', 'true');

  for (const camera of ['Broadcast', 'Chase', 'Cockpit', 'Overhead', 'Free']) {
    const button = page.getByRole('button', { name: `${camera} camera` });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }

  await page.getByRole('button', { name: 'Resume race' }).click();

  for (const speed of ['0.25', '0.5', '1', '2', '4', '8']) {
    await page.getByLabel('Simulation speed').selectOption(speed);
    await expect(page.getByLabel('Simulation speed')).toHaveValue(speed);
  }

  const originalSeed = await simulationSeed(page);
  await page.evaluate(() => window.__RACE_DIAGNOSTICS__!.advanceRace(30));
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Replay seed' }).click();
  await expect(page.getByLabel('Current lap')).toContainText('Lap 1 / 56');
  expect(await simulationSeed(page)).toBe(originalSeed);

  await page.getByRole('button', { name: 'Restart race' }).click();
  expect(await simulationSeed(page)).toBe(originalSeed);
  await page.getByRole('button', { name: 'New race seed' }).click();
  await expect.poll(() => simulationSeed(page)).not.toBe(originalSeed);

  await openMorePanel(page, testInfo);
  await page.getByRole('button', { name: /Open credits and disclosure/ }).first().click();
  const credits = page.getByRole('dialog', { name: 'Credits and disclosure' });
  await expect(credits).toBeVisible();
  await expect(credits.getByText('Independent simulated broadcast')).toBeVisible();
  await expect(credits.getByRole('link', { name: /license/i })).toHaveCount(19);
  await page.keyboard.press('Escape');
  await expect(credits).toHaveCount(0);

  if (testInfo.project.name.startsWith('mobile')) {
    await openMorePanel(page, testInfo);
    await expect(page.getByRole('img', { name: 'Shanghai circuit position map' })).toBeAttached();
    await expect(page.getByRole('list', { name: 'Driver track positions' })).toBeAttached();
    await expect(page.getByTestId('track-map-marker')).toHaveCount(14);
    await page.getByRole('button', { name: 'Close more race information' }).click();
  }
});

test('persists preferences across reloads', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Cockpit camera' }).click();
  await openMorePanel(page, testInfo);
  await page.getByRole('button', { name: 'Hide car labels' }).click();
  await page.getByRole('button', { name: 'Disable race effects' }).click();
  await page.getByRole('button', { name: 'Enable reduced motion' }).click();
  await page.getByLabel('Scene detail').selectOption('mobile');
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Ready · 14 cars on the Shanghai circuit', { timeout: 20_000 });

  await expect(page.getByRole('button', { name: 'Cockpit camera' })).toHaveAttribute('aria-pressed', 'true');
  await openMorePanel(page, testInfo);
  await expect(page.getByRole('button', { name: 'Show car labels' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Enable race effects' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Disable reduced motion' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Scene detail')).toHaveValue('mobile');
});

test('finishes quickly through the diagnostics boundary and exposes replay actions', async ({ page }) => {
  await page.evaluate(() => window.__RACE_DIAGNOSTICS__!.finishRace());
  const finish = page.getByRole('dialog', { name: 'Race complete' });
  await expect(finish).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Current lap')).toContainText('Lap 56 / 56');
  await expect(finish.getByRole('table', { name: 'Final classification' }).getByRole('row')).toHaveCount(15);

  const seed = await simulationSeed(page);
  await finish.getByRole('button', { name: 'Replay this seed' }).click();
  await expect(finish).toHaveCount(0);
  await expect(page.getByLabel('Current lap')).toContainText('Lap 1 / 56');
  expect(await simulationSeed(page)).toBe(seed);

  await page.evaluate(() => window.__RACE_DIAGNOSTICS__!.finishRace());
  await page.getByRole('button', { name: 'Start with a new seed' }).click();
  await expect.poll(() => simulationSeed(page)).not.toBe(seed);
});

test('replays deterministic pit, safety-car, and incident delivery scenarios', async ({ page }, testInfo) => {
  const safetyCheckpoint = await page.evaluate(() => {
    const diagnostics = window.__RACE_DIAGNOSTICS__!;
    diagnostics.restartRace('scenario-2');
    for (let second = 0; second < 400; second += 1) {
      diagnostics.advanceRace(1);
      const snapshot = diagnostics.snapshot();
      if (snapshot.scenario.safetyCarCount > 0 && snapshot.scenario.incidentCount > 0) {
        return snapshot.scenario;
      }
    }
    return diagnostics.snapshot().scenario;
  });
  expect(safetyCheckpoint.incidentCount).toBeGreaterThan(0);
  expect(safetyCheckpoint.safetyCarCount).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Pause race' }).click();
  const safetyCarFrames = await measureFrames(page);
  await page.getByRole('button', { name: 'Resume race' }).click();

  const activePitCheckpoint = await page.evaluate(() => {
    const diagnostics = window.__RACE_DIAGNOSTICS__!;
    diagnostics.restartRace('scenario-2');
    for (let second = 0; second < 400; second += 1) {
      diagnostics.advanceRace(1);
      const snapshot = diagnostics.snapshot();
      if (snapshot.scenario.activePitCars > 0) return snapshot.scenario;
    }
    return diagnostics.snapshot().scenario;
  });
  expect(activePitCheckpoint.activePitCars).toBeGreaterThan(0);
  expect(activePitCheckpoint.pitEntryCount).toBeGreaterThan(0);

  const first = await page.evaluate(() => {
    window.__RACE_DIAGNOSTICS__!.finishRace();
    return window.__RACE_DIAGNOSTICS__!.snapshot().scenario;
  });
  const replay = await page.evaluate(() => {
    window.__RACE_DIAGNOSTICS__!.restartRace('scenario-2');
    window.__RACE_DIAGNOSTICS__!.finishRace();
    return window.__RACE_DIAGNOSTICS__!.snapshot().scenario;
  });
  expect(replay).toEqual(first);
  expect(first).toMatchObject({
    activePitCars: 0,
    safetyCarState: 'none',
  });
  expect(first.pitEntryCount).toBeGreaterThan(0);
  expect(first.incidentCount).toBeGreaterThan(0);
  expect(first.safetyCarCount).toBeGreaterThan(0);

  console.log(`SCENARIO ${testInfo.project.name} safety=${first.safetyCarCount} incidents=${first.incidentCount} pits=${first.pitEntryCount} safety-car=${safetyCarFrames.fps.toFixed(1)}fps/${safetyCarFrames.p95Ms.toFixed(1)}ms-p95`);
});

test('keeps canvas, listeners, audio, and effect pools steady over five restarts and records frame timing', async ({ page }, testInfo) => {
  await openMorePanel(page, testInfo);
  await page.getByRole('button', { name: 'Unmute audio' }).click();
  await expect.poll(() => runtime(page).then((value) => value.audio.contextState)).toBe('running');
  if (testInfo.project.name.startsWith('mobile')) {
    await page.getByRole('button', { name: 'Close more race information' }).click();
  }
  await page.getByRole('button', { name: 'Pause race' }).click();
  // Let Three/WebGL complete its one-time lazy allocations before the five
  // measured restart cycles; otherwise shader/geometry warm-up looks like a leak.
  await page.getByRole('button', { name: 'Restart race' }).click();
  await page.getByRole('button', { name: 'Pause race' }).click();
  await page.waitForTimeout(500);
  const baseline = await runtime(page);
  const listenerBaseline = await page.evaluate(() => window.__listenerAudit__!.active());
  const rendererBaseline = { ...baseline.renderer, drawCalls: 0 };
  expect(baseline).toMatchObject({
    carCount: 14,
    canvasCount: 1,
    effects: { capacity: { smoke: 32, sparks: 64, debris: 24 }, active: 0 },
    audio: { contextState: 'running', ownedNodeCount: 10, ownedSourceCount: 4, transientNodeCount: 0 },
    failedAssetUrls: [],
  });
  expect(rendererBaseline.buffers).toBeGreaterThan(0);
  expect(rendererBaseline.programs).toBeGreaterThan(0);
  expect(rendererBaseline.textures).toBeGreaterThan(0);

  for (let restart = 0; restart < 5; restart += 1) {
    await page.getByRole('button', { name: 'Restart race' }).click();
    await page.getByRole('button', { name: 'Pause race' }).click();
    await expect(page.getByLabel('Current lap')).toContainText('Lap 1 / 56');
    await expect.poll(() => runtime(page).then((value) => value.canvasCount)).toBe(1);
    const current = await runtime(page);
    expect(current.effects).toEqual(baseline.effects);
    expect(current.audio).toEqual(baseline.audio);
    expect({ ...current.renderer, drawCalls: 0 }).toEqual(rendererBaseline);
    await page.evaluate(() => window.__deliveryAudit__!.resetDrawCalls());
    await page.waitForTimeout(250);
    expect((await runtime(page)).renderer.drawCalls).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__listenerAudit__!.active())).toBe(listenerBaseline);
  }

  await page.getByRole('button', { name: 'Resume race' }).click();
  const start = await measureFrames(page);
  await page.evaluate(() => window.__RACE_DIAGNOSTICS__!.advanceRace(150));
  const advanced = await measureFrames(page);
  const target = testInfo.project.name.startsWith('mobile') ? 30 : 60;
  console.log(`PERF ${testInfo.project.name} start=${start.fps.toFixed(1)}fps/${start.p95Ms.toFixed(1)}ms-p95 advanced=${advanced.fps.toFixed(1)}fps/${advanced.p95Ms.toFixed(1)}ms-p95`);
  expect(start.fps).toBeGreaterThanOrEqual(target * 0.85);
  expect(advanced.fps).toBeGreaterThanOrEqual(target * 0.85);
});
