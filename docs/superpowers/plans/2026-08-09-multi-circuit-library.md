# Multi-Circuit Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ten supplied circuit archives as selectable, lazy-loaded race venues alongside Shanghai without sacrificing deterministic simulation, camera quality, licensing traceability, or browser performance.

**Architecture:** Introduce a circuit runtime registry that binds metadata, an authoritative generated `TrackDefinition`, and one optimized GLB URL. Circuit browsing remains static and fast; entering a race asynchronously loads exactly one circuit runtime, then rebuilds the deterministic engine with that circuit's lap count and track definition. A generalized geometry-analysis/generation pipeline converts each supplied archive into an optimized runtime GLB plus aligned spline, pit lane, sectors, zones, grid, map outline, and camera anchors.

**Tech Stack:** TypeScript, React, Zustand, Three.js/React Three Fiber, Vite dynamic imports, Node asset scripts, glTF/GLB, Vitest, Playwright.

## Global Constraints

- Preserve the current clean `feat/f1-simulation` branch and existing Shanghai implementation.
- Never preload all circuit GLBs; load only the selected venue and dispose the previous venue.
- Preserve original ZIPs under `work/assets-source/tracks/`; runtime derivatives belong under `public/assets/models/tracks/`.
- Keep one authoritative spline per visible circuit and validate visual/simulation alignment.
- Use each venue's configured race lap count; remove the current `laps: 56` literal restriction.
- Every circuit needs a center/attack/defend line, pit line, grid, sectors, zones, map outline, and camera anchors before it is marked playable.
- Unverified Sketchfab assets may be used only in the local prototype and must remain visibly marked `UNVERIFIED`; do not publish them.
- Keep 0.25x, 0.5x, 1x, 2x, 4x, and 8x playback.
- Maintain exact asset-ready browser gating, reduced-motion behavior, desktop/mobile performance checks, and deterministic seeded results.
- Commit after every independently testable task.

## Supplied source inventory

| Circuit ID | Archive | Model entry | GLB bytes |
| --- | --- | --- | ---: |
| `suzuka` | `suzuka-circuit-2001-layout.zip` | `source/suzukibananini.glb` | 94,855,336 |
| `melbourne` | `albert-park-circuit-melbourne-2018-layout.zip` | `source/melbourne.glb` | 95,453,724 |
| `barcelona` | `barcelona-catalunya-grand-prix-2023-layout.zip` | `source/untitled.glb` | 88,152,752 |
| `spa` | `circuit-de-spa-francorchamps-2022-layout.zip` | `source/spa.glb` | 83,993,000 |
| `silverstone` | `silverstone-circuit-2024-layout.zip` | `source/silverstone.glb` | 94,771,096 |
| `singapore` | `marina-bay-street-circuit.zip` | `source/singapore.glb` | 63,974,660 |
| `red-bull-ring` | `redbull-ring-2025-layout.zip` | `source/redbullring.glb` | 59,445,712 |
| `austin` | `austin-circuit-of-the-americas-2012-layout.zip` | `source/Untitled_compressed.glb` | 40,604,232 |
| `abu-dhabi` | `yas-marina-circuit-abu-dhabi-2021-layout.zip` | `source/abudhabi_compressed.glb` | 77,792,908 |
| `bahrain` | `bahrain-international-circuit.zip` | `source/bahrain.glb` | 74,754,968 |

The ten source GLBs total approximately 774 MB before their external textures. They must be processed independently and loaded on demand.

## File structure

```text
src/track/circuit-runtime.ts                runtime contract and loader
src/track/circuit-registry.ts               metadata and dynamic-import registry
src/track/generated/<circuit>-track.ts      generated TrackDefinition modules
src/track/generated/<circuit>-manifest.json generation evidence and bounds
src/content/circuits.ts                     playable status and outlines
src/domain/race-types.ts                    variable lap-count configuration
src/domain/race-config.ts                   validated track-specific laps
src/store/race-store.ts                     async circuit selection and engine rebuild
src/scene/RaceScene.tsx                     selected track asset/status boundary
src/scene/Environment.tsx                   runtime GLB instead of Shanghai constant
src/cameras/RaceCameras.tsx                 runtime anchors/bounds
src/ui/TrackMap.tsx                         runtime outline
src/shell/views.tsx                         playable circuit start actions
scripts/track-sources.mjs                   exact source inventory
scripts/analyze-track-geometry.mjs          generalized geometry report
scripts/generate-track.mjs                  generalized TrackDefinition generator
scripts/optimize-track.mjs                  web GLB optimization
scripts/verify-assets.mjs                   all circuit runtime/license checks
public/assets/models/tracks/<id>.glb         optimized lazy-loaded track models
work/assets-source/tracks/<id>/              preserved source/license/evidence
tests/track/circuit-registry.test.ts         registry and generated invariants
tests/store/circuit-selection.test.ts        engine/runtime switching
tests/ui/circuit-library.test.tsx            browse/start/map behavior
tests/e2e/circuits.spec.ts                   loading, switching, cameras, cleanup
```

---

### Task 1: Variable-Lap Circuit Runtime Contract

**Files:**
- Create: `src/track/circuit-runtime.ts`
- Create: `src/track/circuit-registry.ts`
- Modify: `src/domain/race-types.ts`
- Modify: `src/domain/race-config.ts`
- Modify: `src/content/circuits.ts`
- Test: `tests/track/circuit-registry.test.ts`

**Interfaces:**
- Consumes: `TrackDefinition`, existing `Circuit`, `SHANGHAI_TRACK`.
- Produces: `PlayableCircuitId`, `CircuitRuntime`, `loadCircuitRuntime(id)`, variable `RaceConfig.laps`.

- [ ] **Step 1: Write the failing runtime-contract test**

```ts
import { loadCircuitRuntime, PLAYABLE_CIRCUIT_IDS } from '../../src/track/circuit-registry';

it('loads Shanghai through the same lazy runtime contract used by every circuit', async () => {
  expect(PLAYABLE_CIRCUIT_IDS).toContain('shanghai');
  const runtime = await loadCircuitRuntime('shanghai');
  expect(runtime.id).toBe('shanghai');
  expect(runtime.track.id).toBe('shanghai');
  expect(runtime.laps).toBeGreaterThan(1);
  expect(runtime.assetUrl).toMatch(/shanghai-track\.glb$/);
});
```

- [ ] **Step 2: Run it and confirm RED**

Run: `npm test -- tests/track/circuit-registry.test.ts`

Expected: FAIL because the runtime registry does not exist.

- [ ] **Step 3: Add the runtime contract and Shanghai loader**

```ts
// src/track/circuit-runtime.ts
import type { TrackDefinition } from './track-types';

export interface CircuitRuntime {
  id: string;
  laps: number;
  assetUrl: string;
  track: TrackDefinition;
}
```

```ts
// src/track/circuit-registry.ts
import type { CircuitRuntime } from './circuit-runtime';

const LOADERS = {
  shanghai: async (): Promise<CircuitRuntime> => {
    const { SHANGHAI_RACE_LAPS, SHANGHAI_TRACK } = await import('./shanghai-track');
    return {
      id: 'shanghai',
      laps: SHANGHAI_RACE_LAPS,
      assetUrl: '/assets/models/tracks/shanghai.glb',
      track: SHANGHAI_TRACK,
    };
  },
} as const;

export type PlayableCircuitId = keyof typeof LOADERS;
export const PLAYABLE_CIRCUIT_IDS = Object.freeze(Object.keys(LOADERS) as PlayableCircuitId[]);

export function loadCircuitRuntime(id: PlayableCircuitId): Promise<CircuitRuntime> {
  return LOADERS[id]();
}
```

- [ ] **Step 4: Generalize lap validation**

Change `RaceConfig.laps` from literal `56` to `number`. Validate with `z.number().int().min(1).max(100)` and keep Shanghai's default at 56. Add tests that accept a known circuit lap count and reject zero, fractional, and over-100 values.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- tests/track/circuit-registry.test.ts tests/domain/grid-2026.test.ts`

Run: `npm run build`

```bash
git add src/track/circuit-runtime.ts src/track/circuit-registry.ts src/domain src/content/circuits.ts tests/track/circuit-registry.test.ts tests/domain
git commit -m "refactor: add lazy circuit runtime contract"
```

---

### Task 2: Generalized Track Asset Pipeline

**Files:**
- Create: `scripts/track-sources.mjs`
- Create: `scripts/generate-track.mjs`
- Create: `scripts/optimize-track.mjs`
- Modify: `scripts/analyze-track-geometry.mjs`
- Modify: `scripts/verify-assets.mjs`
- Create: `tests/assets/track-pipeline.test.ts`

**Interfaces:**
- Consumes: the exact archive/model table above.
- Produces: reproducible `analyze`, `optimize`, and `generate` commands for one circuit ID.

- [ ] **Step 1: Encode the immutable source inventory**

```js
// scripts/track-sources.mjs
export const TRACK_SOURCES = Object.freeze({
  suzuka: { archive: '/Users/mayankkinger/Downloads/suzuka-circuit-2001-layout.zip', model: 'source/suzukibananini.glb' },
  melbourne: { archive: '/Users/mayankkinger/Downloads/albert-park-circuit-melbourne-2018-layout.zip', model: 'source/melbourne.glb' },
  barcelona: { archive: '/Users/mayankkinger/Downloads/barcelona-catalunya-grand-prix-2023-layout.zip', model: 'source/untitled.glb' },
  spa: { archive: '/Users/mayankkinger/Downloads/circuit-de-spa-francorchamps-2022-layout.zip', model: 'source/spa.glb' },
  silverstone: { archive: '/Users/mayankkinger/Downloads/silverstone-circuit-2024-layout.zip', model: 'source/silverstone.glb' },
  singapore: { archive: '/Users/mayankkinger/Downloads/marina-bay-street-circuit.zip', model: 'source/singapore.glb' },
  'red-bull-ring': { archive: '/Users/mayankkinger/Downloads/redbull-ring-2025-layout.zip', model: 'source/redbullring.glb' },
  austin: { archive: '/Users/mayankkinger/Downloads/austin-circuit-of-the-americas-2012-layout.zip', model: 'source/Untitled_compressed.glb' },
  'abu-dhabi': { archive: '/Users/mayankkinger/Downloads/yas-marina-circuit-abu-dhabi-2021-layout.zip', model: 'source/abudhabi_compressed.glb' },
  bahrain: { archive: '/Users/mayankkinger/Downloads/bahrain-international-circuit.zip', model: 'source/bahrain.glb' },
});
```

- [ ] **Step 2: Write pipeline tests**

Assert unique IDs, existing ZIPs, existing model entries, output paths restricted to the workspace, GLB v2 validity, and no mutation of archive mtimes/checksums.

- [ ] **Step 3: Generalize analysis and generation**

Expose:

```bash
node scripts/analyze-track-geometry.mjs --circuit suzuka
node scripts/optimize-track.mjs --circuit suzuka
node scripts/generate-track.mjs --circuit suzuka
```

Each command must resolve its source from `TRACK_SOURCES`, write only beneath `work/assets-source/tracks/<id>/` or `public/assets/models/tracks/`, and emit one JSON envelope containing source checksum, bounds, mesh/material/triangle counts, detected road/pit/grid nodes, output size, and warnings.

- [ ] **Step 4: Add verification limits**

Require every runtime track to be a semantically loadable GLB, remain below 30 MB unless an explicit per-circuit exception is documented, and have a matching credit entry plus generated manifest.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- tests/assets/track-pipeline.test.ts tests/assets/verify-assets.test.ts`

```bash
git add scripts tests/assets/track-pipeline.test.ts
git commit -m "feat: generalize circuit asset pipeline"
```

---

### Task 3: Generate and Validate the Ten Circuit Definitions

**Files:**
- Create: `src/track/generated/{suzuka,melbourne,barcelona,spa,silverstone,singapore,red-bull-ring,austin,abu-dhabi,bahrain}-track.ts`
- Create: `src/track/generated/<id>-manifest.json` for each circuit
- Create: `public/assets/models/tracks/<id>.glb` for each circuit
- Create: `work/assets-source/tracks/<id>/optimization-notes.md` for each circuit
- Modify: `src/track/circuit-registry.ts`
- Test: `tests/track/generated-circuits.test.ts`

**Interfaces:**
- Consumes: generalized pipeline and calendar metadata.
- Produces: ten independently loadable `CircuitRuntime` entries.

- [ ] **Step 1: Write the invariant matrix test**

For every supplied ID, assert: closed center/attack/defend lines, open pit line, at least 22 grid slots, exactly three ordered sector boundaries, at least one passing/yellow/speed-limit zone, at least six named camera anchors, finite transforms, and fitted length within 5% of the corresponding circuit metadata.

- [ ] **Step 2: Generate one circuit at a time**

Run analyze → inspect report → optimize → generate for each ID. Do not batch past a failing circuit. Preserve the source archive and write optimization evidence before registering it.

- [ ] **Step 3: Inspect alignment visually**

For each circuit, render centerline, pit line, grid slots, sectors, and camera anchors as temporary diagnostics over the GLB. Capture one overhead and two track-level screenshots. Fix transforms in the generator manifest, not with ad-hoc scene offsets.

- [ ] **Step 4: Register only validated tracks**

Add a loader entry only after its model and invariant test pass. Mark its `Circuit.status` as `playable` and derive the SVG outline with the existing `traceOutline` helper.

- [ ] **Step 5: Verify and commit in two reviewable batches**

Batch A: Suzuka, Melbourne, Barcelona, Spa, Silverstone.

Batch B: Singapore, Red Bull Ring, Austin, Abu Dhabi, Bahrain.

Run: `npm test -- tests/track/generated-circuits.test.ts tests/track/spline-track.test.ts`

Run: `npm run verify:assets`

Commit each batch separately.

---

### Task 4: Circuit Selection and Engine Rebuild

**Files:**
- Modify: `src/store/race-store.ts`
- Modify: `src/scene/RaceScene.tsx`
- Modify: `src/scene/Environment.tsx`
- Modify: `src/cameras/RaceCameras.tsx`
- Modify: `src/ui/TrackMap.tsx`
- Modify: `src/shell/router.ts`
- Modify: `src/shell/views.tsx`
- Create: `tests/store/circuit-selection.test.ts`
- Create: `tests/ui/circuit-library.test.tsx`

**Interfaces:**
- Consumes: `loadCircuitRuntime(id)`.
- Produces: `loadCircuit(id)`, `circuitStatus`, and runtime-dependent scene/engine/UI.

- [ ] **Step 1: Write failing selection tests**

Assert that selecting a playable circuit enters a loading state, loads the runtime, rebuilds the engine with the circuit's laps/track, clears event feed and selection, reaches ready, and preserves user preferences. A failed model/runtime load must expose the filename and keep the prior circuit recoverable.

- [ ] **Step 2: Add async circuit state**

Add to `RaceStoreState`:

```ts
circuitId: PlayableCircuitId;
circuitRuntime: Readonly<CircuitRuntime>;
circuitStatus: 'ready' | 'loading' | 'error';
circuitError: string | null;
loadCircuit(id: PlayableCircuitId): Promise<void>;
```

Use a monotonically increasing request token so a slower previous request cannot overwrite the latest selection.

- [ ] **Step 3: Remove Shanghai constants from consumers**

`RaceScene`, `Environment`, `RaceCameras`, and `TrackMap` must select from `state.circuitRuntime`. Dispose the previous track GLB/material clones after a successful swap. Keep cars, audio, and HUD mounted where possible.

- [ ] **Step 4: Wire browse/start actions**

Playable circuit cards route to the race with a circuit ID, trigger `loadCircuit`, display loading/error states, and disable race start for planned/unverified venues. Preserve keyboard navigation and back navigation.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- tests/store/circuit-selection.test.ts tests/ui/circuit-library.test.tsx tests/ui/race-scene.test.tsx`

Run: `npm run build`

```bash
git add src/store src/scene src/cameras src/ui/TrackMap.tsx src/shell tests/store/circuit-selection.test.ts tests/ui/circuit-library.test.tsx
git commit -m "feat: add lazy circuit selection"
```

---

### Task 5: Circuit-Aware Cameras, Maps, and Presentation

**Files:**
- Modify: `src/cameras/camera-director.ts`
- Modify: `src/cameras/RaceCameras.tsx`
- Modify: `src/ui/TrackMap.tsx`
- Modify: `src/ui/RaceHud.tsx`
- Modify: `src/content/circuits.ts`
- Test: `tests/simulation/camera-director.test.ts`
- Test: `tests/ui/race-hud.test.tsx`

**Interfaces:**
- Consumes: runtime camera anchors, bounds, outline, circuit metadata.
- Produces: venue-aware cinematic shots and labels.

- [ ] **Step 1: Add circuit-aware camera tests**

For each runtime, assert every anchor targets a valid track zone, its projected target is in-frame at desktop and portrait aspect ratios, and automatic direction can select trackside/aerial/drone-style coverage without hard-coded Shanghai constants.

- [ ] **Step 2: Replace Shanghai labels and geometry assumptions**

Use runtime metadata for title, country, lap count, circuit map, camera shot name, bounds, and overhead clearance. Keep the compact manual camera categories already present.

- [ ] **Step 3: Preserve shot quality during swaps**

On circuit change, reset the director watermark and shot state, choose a safe starting anchor, and snap the first broadcast pose. Chase/cockpit/drone remain damped and must follow rendered car transforms to avoid jitter.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- tests/simulation/camera-director.test.ts tests/ui/race-hud.test.tsx tests/ui/race-scene.test.tsx`

```bash
git add src/cameras src/ui src/content tests/simulation/camera-director.test.ts tests/ui
git commit -m "feat: make cameras and HUD circuit-aware"
```

---

### Task 6: Licensing, Performance, and Multi-Circuit E2E

**Files:**
- Modify: `src/assets/credits.json`
- Modify: `src/ui/CreditsPanel.tsx`
- Modify: `tests/e2e/race.spec.ts`
- Create: `tests/e2e/circuits.spec.ts`
- Modify: `README.md`
- Create: `docs/MULTI-CIRCUIT-ASSET-STATUS.md`

**Interfaces:**
- Consumes: all registered runtimes.
- Produces: verified local prototype and publication-blocking license report.

- [ ] **Step 1: Add the browser matrix**

For every playable circuit on desktop and a rotating mobile subset, assert: exact ready status, correct name/laps/map, 22 selectable cars, camera target in frame, 0.25x/0.5x behavior, zero asset/request/page errors, and one canvas.

- [ ] **Step 2: Verify lazy loading and cleanup**

Record network requests and prove only the chosen track GLB loads. Switch through all circuits sequentially and assert WebGL geometry/texture counts return to a bounded steady state after each disposal.

- [ ] **Step 3: Measure performance**

Measure start, dense first-corner pack, pit congestion, safety-car bunching, and incident effects on desktop and mobile. If necessary, add per-circuit high/mobile LOD choices; never reduce simulation correctness to meet rendering targets.

- [ ] **Step 4: Close or document licensing**

`MULTI-CIRCUIT-ASSET-STATUS.md` must list source URL, creator, license, sponsor-mark review, runtime path, and publication status for every track. If any field is missing, keep that circuit local-only and block public hosting.

- [ ] **Step 5: Run the final gate and commit**

Run:

```bash
npm test
npm run verify:assets
npm run build
npm run test:e2e
git diff --check
```

Run the full deterministic seed soak separately and record its time.

```bash
git add src/assets src/ui/CreditsPanel.tsx tests/e2e README.md docs/MULTI-CIRCUIT-ASSET-STATUS.md
git commit -m "test: verify multi-circuit race library"
```

## Self-review

- Spec coverage: source intake, optimization, track generation, runtime selection, simulation laps, cameras, map/HUD, licensing, lazy loading, cleanup, performance, and E2E each have a task.
- Placeholder scan: no implementation step delegates an undefined behavior; generated per-circuit numeric data comes from the explicit geometry pipeline and is validated before registration.
- Type consistency: `PlayableCircuitId`, `CircuitRuntime`, `loadCircuitRuntime`, `circuitRuntime`, and `loadCircuit` retain the same names across tasks.
