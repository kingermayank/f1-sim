import { build, preview } from 'vite';

await build({ mode: 'e2e' });
const server = await preview({
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
});

const shutdown = async () => {
  await server.close();
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
