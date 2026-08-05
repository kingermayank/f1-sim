import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, preview } from 'vite';

const outputDirectory = await mkdtemp(join(tmpdir(), 'shanghai-e2e-'));

await build({ mode: 'e2e', build: { outDir: outputDirectory, emptyOutDir: true } });
const server = await preview({
  build: { outDir: outputDirectory },
  preview: { host: '127.0.0.1', port: 5189, strictPort: true },
});

const shutdown = async () => {
  await server.close();
  await rm(outputDirectory, { recursive: true, force: true });
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
