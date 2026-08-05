# Handoff: Shanghai Circuit + Sketchfab F1 Assets

## Objective

Continue the browser-based dynamic F1 race simulation by replacing the current project-original Monaco presentation assets with the user-provided **Shanghai International Circuit — 2018 layout** and licensed F1 car assets. Build the strongest possible cinematic camera system for Shanghai. Turn 1/Turn 2, top-down, bird's-eye, and drone-style views are inspiration and examples, not mandatory preset names or a fixed list.

The simulation must remain deterministic, performant, accessible, and legally attributable. Do not treat this as a visual-only model swap: the authoritative race spline, pit lane, sectors, lap count, cameras, map, naming, and tests must all become Shanghai-specific.

## Exact workspace

- Repository root: `/Users/mayankkinger/Documents/Codex/2026-08-04/i`
- Active implementation worktree: `/Users/mayankkinger/Documents/Codex/2026-08-04/i/.worktrees/feat-f1-simulation`
- Active branch: `feat/f1-simulation`
- Last committed revision at handoff: `6e55e97`
- Current local app: `http://127.0.0.1:5173/`
- Approved design: `docs/superpowers/specs/2026-08-04-f1-monaco-dynamic-simulation-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-04-f1-monaco-dynamic-simulation.md`
- Delivery evidence: `task-13-report.md`

### Important working-tree warning

The worktree intentionally contains **uncommitted final improvements** made after `6e55e97`. They include slower 0.25x/0.5x playback, richer HUD data, seeded qualifying/weather/fuel/controller improvements, upgraded original cars/environment, camera framing fixes, and stronger E2E diagnostics.

Before editing:

1. Run `git status --short`.
2. Preserve every existing modification.
3. Do not reset, checkout, clean, or overwrite the dirty worktree.
4. Run focused verification and commit the existing integrated final changes before beginning the Shanghai migration, unless the user explicitly directs otherwise.

## User-provided asset inventory

Assets currently discovered in Downloads:

### Track

- Archive: `/Users/mayankkinger/Downloads/shanghai-international-circuit-2018-layout.zip`
- Model inside archive: `source/shanghai_compressed.glb`
- GLB size: approximately 92.8 MB
- Archive includes many external PNG textures.

### Cars currently discovered

- `/Users/mayankkinger/Downloads/aston-martin-aramco-amr25.zip`
  - Model: `source/Aston Martin Aramco AMR25.glb`
- `/Users/mayankkinger/Downloads/2025-alpine-a525.zip`
  - Model: `source/f1-2025_alpine_a525.glb`
- `/Users/mayankkinger/Downloads/f1-2025-redbull-rb21.zip`
  - Contains a nested `source/F1-2025 Redbull RB21.zip`; inspect and extract it separately.

The user may have more car archives. Inventory Downloads again before implementation. The 2026 simulation currently contains **11 teams and 22 drivers**, not 10 teams. Do not silently show 10 teams or reuse one team's branded car for another team.

## Required asset intake structure

Preserve immutable source archives separately from optimized runtime files:

```text
work/assets-source/incoming/
  shanghai-international-circuit-2018-layout.zip
  cars/
    <original Sketchfab archives>

work/assets-source/shanghai/
  original/
  license/
  optimization-notes.md

work/assets-source/cars/<team-id>/
  original/
  license/
  optimization-notes.md

public/assets/models/
  shanghai-track.glb
  cars/<team-id>.glb
```

Do not edit the originals. Copy them into `work/assets-source/` and produce separate runtime exports.

## Licensing and trademark gate

Before a supplied model is used:

1. Record its exact Sketchfab page URL, creator, download date, and license.
2. Preserve any license/readme file from the authorized download.
3. Confirm the license permits modification and web redistribution. Reject paid, editorial-only, NoAI-restricted, or unclear assets.
4. Add one entry per runtime model to `src/assets/credits.json` with accurate modifications.
5. Extend `scripts/verify-assets.mjs` so every new runtime model and source record is checked.
6. Do not describe official team marks, sponsor logos, driver likenesses, or trademarks as CC0/project-original.

The current visible team/driver naming is intended for a private prototype. Keep the disclosure in the credits panel.

## Shanghai migration sequence

### 1. Stabilize and checkpoint the existing build

- Run the focused unit/UI/scene tests covering the current dirty changes.
- Run `npm run build`, `npm run verify:assets`, and `git diff --check`.
- Commit the existing final improvements separately from the Shanghai asset migration.

### 2. Inspect and optimize the Shanghai GLB

- Extract the archive without modifying it.
- Inspect scene hierarchy, material count, bounds, units, up axis, draw calls, texture references, and triangle count.
- Remove unused nodes/materials and any unintended embedded cameras/lights.
- Normalize scale and orientation for Three.js (`Y` up, consistent meters).
- Compress geometry and textures. Target a practical web payload; the original ~93 MB GLB is too large for routine initial loading.
- Preserve important Shanghai landmarks: long back straight, Turns 1–2 spiral, pit complex, grandstands, bridges, and trackside structures.
- Avoid shipping unauthorized sponsor textures if their use is not covered; replace them with neutral project-original boards when necessary.

### 3. Replace the authoritative track definition

Create Shanghai equivalents for the current Monaco files rather than merely swapping the visible mesh:

```text
src/track/shanghai-track.ts
src/track/track-types.ts
src/scene/Environment.tsx
src/ui/TrackMap.tsx
src/assets/asset-registry.ts
```

Required data:

- A closed center/racing spline aligned precisely to the Shanghai GLB.
- Attack and defend lines.
- Pit-entry, pit-lane, pit-box, and pit-exit spline.
- Starting grid positions for all 22 cars.
- Three sector boundaries.
- Overtaking, yellow, and pit-speed zones.
- Camera anchors/presets.
- Shanghai display name, map projection, and environment bounds.

Recommended race length: use Shanghai's normal **56-lap** Grand Prix distance unless the user requests a custom lap count. Update validation and presentation timing deliberately; do not leave Monaco's 78 laps in a Shanghai-branded race.

### 4. Integrate car models efficiently

- Do not load 22 copies of 60–120 MB source cars.
- Optimize each team car to a web-ready GLB and load each unique team geometry once.
- Clone/instance the shared team model for its two drivers.
- Preserve separate body, carbon, tire, glass, metal, and emissive materials.
- Add clear per-driver number/identifier treatment.
- Add high/mobile LODs and a legal procedural fallback.
- If all 11 legally usable team models are unavailable, use a high-quality neutral formula-car model with project-authored team treatments for missing teams and clearly disclose that fallback.

### 5. Design the best possible camera system

The user did **not** prescribe literal Turn 1, Turn 2, bird's-eye, or drone buttons. Those were examples of useful perspectives. Use the Shanghai geometry to design a coherent shot library and expose only the most valuable user choices.

Keep the existing Broadcast, Chase, Cockpit, Overhead, and Free modes unless a clearer grouping improves the experience. Recommended direction:

- **Automatic Broadcast:** event-aware direction that selects the best trackside, corner, aerial, or battle shot. Use establishing views sparingly and keep featured cars large and unobstructed.
- **Trackside:** curated cameras at Shanghai's visually distinctive locations, including—but not limited to—the Turns 1–2 spiral, hairpin braking zones, pit straight, and long back straight.
- **Aerial:** choose between high oblique, near-top-down, and wide circuit context depending on the action. Turn 1/Turn 2 bird's-eye compositions are useful reference examples.
- **Drone Follow:** smooth elevated follow/orbit behavior around the selected car or closest battle, with adjustable or automatically composed distance.
- **Driver Views:** retain chase and cockpit for following the selected driver.
- **Free Camera:** retain orbit/free inspection.

The UI may expose a compact set such as `Broadcast`, `Trackside`, `Aerial`, `Drone`, `Chase`, `Cockpit`, and `Free`, or another well-justified grouping. Do not create a separate button for every corner unless testing proves that improves usability.

Each camera definition should include a name, Shanghai track distance/zone, position or relative rig, target behavior, FOV, aspect-aware safe-frame offset, minimum shot duration, and reduced-motion behavior. Fixed broadcast cuts should snap; chase/cockpit/drone movement may be damped. The automatic director should rank overtakes, incidents, pit action, close battles, starts, and finishes, then choose the camera that best shows that event.

### 6. Update product language and UI

- Replace Monaco/Monte Carlo labels with Shanghai-specific naming.
- Update title, track map, lap count, credits, and generated-timing disclosure.
- Keep the slower playback controls: 0.25x, 0.5x, 1x, 2x, 4x, and 8x.
- Recheck tablet/mobile HUD footprint so the race remains the visual subject.

### 7. Verification requirements

Add or update tests for:

- Shanghai spline closure, sectors, grid, pit lane, and zones.
- Visual model bounds aligned with the authoritative spline.
- All supplied assets load to exact `Ready`; procedural fallback must fail delivery E2E.
- Every declared asset has a verified license and runtime file.
- All 22 drivers render once and can be selected.
- The chosen manual camera categories are selectable and persist; automatic direction demonstrably uses varied trackside, aerial, and moving shots while keeping its target in frame.
- No camera jitter at 0.25x, 0.5x, 1x, or 8x.
- Desktop and mobile frame-time targets.
- Five restarts without growth in canvas, WebGL memory, listeners, audio nodes, or effects pools.

Final commands:

```bash
npm test
npm run verify:assets
npm run build
npm run test:e2e
git diff --check
```

Run the full 22-car seed soak separately because it is intentionally expensive.

## Acceptance criteria

- Shanghai 2018 circuit geometry is visibly used and aligned to car motion.
- The race uses the correct Shanghai name, map, sectors, pit lane, grid, and intended lap count.
- Every displayed car model has traceable permission and accurate credits.
- Cars remain readable and performant; no 100 MB-per-car loading pattern.
- The camera system offers strong, varied Shanghai-specific perspectives, including curated corner, aerial/top-down, and drone-style coverage where they improve the shot; exact preset names are a design decision.
- 0.25x and 0.5x are available and visibly smoother, without changing deterministic outcomes.
- Browser status reaches exact `Ready` with zero asset/network/console errors.
- Desktop/mobile E2E, asset verification, build, and focused simulation tests pass.

## Do not do

- Do not scrape Sketchfab or bypass authenticated downloads.
- Do not use models whose license/source cannot be verified.
- Do not swap only the visible track mesh while leaving Monaco splines underneath.
- Do not load one heavyweight GLB per rendered car.
- Do not delete or reset the existing dirty worktree.
- Do not stop the user-visible server on port 5173 while they are testing.
