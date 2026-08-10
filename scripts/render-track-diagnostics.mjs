import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--circuit' || !/^[a-z0-9-]+$/u.test(args[1])) {
  throw new Error('Expected --circuit <id>');
}
const id = args[1];
const projectRoot = resolve(import.meta.dirname, '..');
const outputRoot = resolve(projectRoot, `work/assets-source/tracks/${id}/diagnostics`);
mkdirSync(outputRoot, { recursive: true });

const server = await createServer({
  root: projectRoot,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Unable to resolve diagnostic server port');
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const outputs = [];
  for (const view of ['overhead', 'track-level-1', 'track-level-2']) {
    await page.goto(`http://127.0.0.1:${address.port}/scripts/track-diagnostic-page.html?circuit=${id}&view=${view}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__diagnosticReady === true, undefined, { timeout: 30_000 });
    const output = resolve(outputRoot, `${view}.png`);
    await page.screenshot({ path: output, type: 'png' });
    outputs.push(output);
  }
  if (errors.length > 0) throw new Error(errors.join('; '));
  console.log(JSON.stringify({ circuitId: id, outputs }));
} finally {
  await browser?.close();
  await server.close();
}
