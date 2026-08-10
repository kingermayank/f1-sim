import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, relative, resolve } from 'node:path';

const SOURCE_ROOT = process.env.TRACK_SOURCE_ROOT ?? '/Users/mayankkinger/Downloads';

const source = (archive, model) => Object.freeze({
  archive: resolve(SOURCE_ROOT, archive),
  model,
});

export const TRACK_SOURCES = Object.freeze({
  suzuka: source('suzuka-circuit-2001-layout.zip', 'source/suzukibananini.glb'),
  melbourne: source('albert-park-circuit-melbourne-2018-layout.zip', 'source/melbourne.glb'),
  barcelona: source('barcelona-catalunya-grand-prix-2023-layout.zip', 'source/untitled.glb'),
  spa: source('circuit-de-spa-francorchamps-2022-layout.zip', 'source/spa.glb'),
  silverstone: source('silverstone-circuit-2024-layout.zip', 'source/silverstone.glb'),
  singapore: source('marina-bay-street-circuit.zip', 'source/singapore.glb'),
  'red-bull-ring': source('redbull-ring-2025-layout.zip', 'source/redbullring.glb'),
  austin: source('austin-circuit-of-the-americas-2012-layout.zip', 'source/Untitled_compressed.glb'),
  'abu-dhabi': source('yas-marina-circuit-abu-dhabi-2021-layout.zip', 'source/abudhabi_compressed.glb'),
  bahrain: source('bahrain-international-circuit.zip', 'source/bahrain.glb'),
});

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TRACK_WORK_ROOT = resolve(PROJECT_ROOT, 'work/assets-source/tracks');
export const TRACK_PUBLIC_ROOT = resolve(PROJECT_ROOT, 'public/assets/models/tracks');

export class TrackPipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TrackPipelineError';
    this.code = code;
  }
}

export function resolveCircuitArgs(args) {
  if (args.length !== 2 || args[0] !== '--circuit' || !args[1]) {
    throw new TrackPipelineError('INVALID_ARGUMENTS', 'Expected exactly: --circuit <circuit-id>');
  }
  const id = args[1];
  const sourceConfig = TRACK_SOURCES[id];
  if (!sourceConfig) {
    throw new TrackPipelineError('UNKNOWN_CIRCUIT', `Unknown circuit ID: ${id}`);
  }
  return { id, source: sourceConfig };
}

export function assertPathInside(root, candidate) {
  const child = relative(root, candidate);
  if (child === '' || child === '..' || child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || resolve(candidate) !== candidate) {
    throw new TrackPipelineError('UNSAFE_OUTPUT_PATH', `Output path must remain beneath ${root}`);
  }
  return candidate;
}

export function isMainModule(metaUrl) {
  return Boolean(process.argv[1]) && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

export async function runJsonCommand(command, operation) {
  try {
    const data = await operation();
    console.log(JSON.stringify({ schemaVersion: 1, ok: true, command, data }));
  } catch (error) {
    const code = error instanceof TrackPipelineError ? error.code : 'PIPELINE_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${command}] ${message}`);
    console.log(JSON.stringify({ schemaVersion: 1, ok: false, command, error: { code, message } }));
    process.exitCode = 1;
  }
}
