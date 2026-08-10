import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, relative, resolve } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

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

function isPathInsideOrEqual(root, candidate) {
  const child = relative(root, candidate);
  return child === '' || (child !== '..' && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

let testOutputRootError;

function resolveTestOutputRoot() {
  if (process.env.NODE_ENV !== 'test' || !process.env.TRACK_PIPELINE_TEST_ROOT) return undefined;
  try {
    const candidate = realpathSync(resolve(process.env.TRACK_PIPELINE_TEST_ROOT));
    const temporaryRoot = realpathSync(tmpdir());
    if (isPathInsideOrEqual(temporaryRoot, candidate)) return candidate;
    testOutputRootError = 'TRACK_PIPELINE_TEST_ROOT must resolve beneath the operating-system temp directory';
  } catch (error) {
    testOutputRootError = `Unable to resolve TRACK_PIPELINE_TEST_ROOT: ${error instanceof Error ? error.message : String(error)}`;
  }
  return undefined;
}

export const TRACK_OUTPUT_ROOT = resolveTestOutputRoot() ?? realpathSync(PROJECT_ROOT);
export const TRACK_WORK_ROOT = resolve(TRACK_OUTPUT_ROOT, 'work/assets-source/tracks');
export const TRACK_PUBLIC_ROOT = resolve(TRACK_OUTPUT_ROOT, 'public/assets/models/tracks');

export class TrackPipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TrackPipelineError';
    this.code = code;
  }
}

export function resolveCircuitArgs(args) {
  if (testOutputRootError) {
    throw new TrackPipelineError('UNSAFE_TEST_OUTPUT_ROOT', testOutputRootError);
  }
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
  const lexicalEscape = candidate === root || !isPathInsideOrEqual(root, candidate) || resolve(candidate) !== candidate;
  const canonicalRoot = canonicalizeWithMissing(root);
  const canonicalCandidate = canonicalizeWithMissing(candidate);
  const canonicalEscape = !isPathInsideOrEqual(TRACK_OUTPUT_ROOT, canonicalRoot)
    || canonicalRoot === canonicalCandidate
    || !isPathInsideOrEqual(canonicalRoot, canonicalCandidate);
  if (lexicalEscape || canonicalEscape) {
    throw new TrackPipelineError('UNSAFE_OUTPUT_PATH', `Output path must remain beneath ${root}`);
  }
  return candidate;
}

function canonicalizeWithMissing(path) {
  let ancestor = resolve(path);
  const missing = [];
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    missing.unshift(basename(ancestor));
    ancestor = parent;
  }
  return resolve(realpathSync(ancestor), ...missing);
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
