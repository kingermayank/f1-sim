# Task 13 — Browser Verification, Performance, and Delivery Readiness

Date: 2026-08-04

Branch: `feat/f1-simulation`
Environment: macOS 15.5, Apple Silicon, Node.js 25.2.1, npm 11.13.0, Playwright 1.62.1, system Google Chrome 151.0.7922.75 (headless)

## Delivered

- Added a production-build Playwright server owned and shut down by Playwright. It uses an existing matching Playwright Chromium when available, then an explicit local executable, then installed macOS Google Chrome; it does not download browsers automatically.
- Added 1440×900 desktop Chromium and 390×844 mobile Chromium projects.
- Added eight total E2E executions covering load/ready state, all 22 timing and scene driver controls, select/follow, five camera modes, pause/resume, 1×/2×/4×/8×, restart/replay/new seed, credits, local preference persistence, mobile timing drawer/map semantics, accelerated 78-lap finish, finish replay/new-seed actions, and browser error collection.
- Added a narrow `?diagnostics=1` development/e2e boundary for deterministic accelerated advance/finish and safe race/canvas/audio/effect inspection. It is disabled in normal production builds.
- Added audio ownership diagnostics and unit coverage for uninitialized, running, and disposed states.
- Added accessible labels for current lap and simulation seed.
- Added an inline favicon after the strict browser console gate found Chrome's automatic `/favicon.ico` 404.
- Serialized Vitest workers after proving default file parallelism starved the CPU-heavy full-race suites and the verifier's real browser decoder.
- Added complete user/developer documentation in `README.md`.

## Root-cause verification

The initial unit baseline ran for 803.10 seconds and failed 2 of 97 tests:

- `verify-assets.test.ts` rejected its valid fixture before corruption.
- The racing-line restoration test exceeded its 5-second timeout.

Both passed independently: the asset test took 10.08 seconds, and the race-rules file passed 12/12 in 42.18 seconds (racing-line case 3.832 seconds; 200-seed case 35.392 seconds). Running the complete suite with one Vitest worker passed 97/97 in 62.79 seconds. This confirmed file-level CPU/browser-process oversubscription as the cause, so `maxWorkers: 1` was configured; no test timeout was widened.

Vite's development server also blocked before binding port 5173 while macOS FSEvents registered watchers for the linked worktree. The production build completed in about one second, so E2E now uses a programmatic Vite `e2e` build plus preview server. This avoids the watcher boundary and more closely exercises production output.

## Final verification results

| Check | Result | Measured duration |
|---|---:|---:|
| `npm test` | 16 files, 100 tests passed | Vitest 63.68s; wall 64.30s |
| `npm run verify:assets` | 13 manifest entries verified | wall 3.62s |
| `npm run build` | TypeScript + Vite build passed | wall 1.10s |
| `npm run test:e2e` | 8/8 passed across both projects | Playwright 48.6s; wall 49.16s |
| Isolated 200-seed soak | 200/200 seeds, zero invariant failures | test 34.452s; wall 36.15s |
| Server cleanup | no listener on TCP 5173 after E2E | passed |
| Diff hygiene | `git diff --check` | passed |

The production bundle contains 684 transformed modules. Main output is 1,318.98 kB raw / 364.98 kB gzip. Vite reports its advisory for a chunk over 500 kB; this is a delivery limitation, not a build failure.

## Browser error gate

Every E2E test collected browser console errors, uncaught page errors, failed requests, and HTTP responses with status 400 or higher. The final combined run recorded zero in every category on desktop and mobile.

## Performance samples

Frame timing uses `requestAnimationFrame` over two-second windows in headless Chrome. “Advanced” means the deterministic diagnostics boundary advanced the live race by 150 presentation seconds before sampling.

| Viewport | Start | Advanced | Target |
|---|---:|---:|---:|
| 1440×900 desktop | 66.2 FPS, 18.3ms p95 | 104.1 FPS, 16.8ms p95 | 60 FPS |
| 390×844 mobile emulation | 118.5 FPS, 10.0ms p95 | 120.0 FPS, 10.0ms p95 | 30 FPS |

These are approximate main-thread presentation timings on a desktop machine, not GPU telemetry from a physical phone. Both clear the requested thresholds, so no scene-quality reductions were made. Separate project runs also passed (desktop start 66.9 FPS; mobile start 118.0 FPS), indicating the combined run was representative.

## Five-restart steady state

The resource scenario ran independently in both projects, for ten restart cycles total. After each of five restarts per viewport it verified:

- exactly one live canvas;
- the independently instrumented active event-listener count was unchanged from the post-load baseline;
- audio remained at one running context graph with 10 owned nodes, 4 owned sources, and 0 transient nodes;
- effect pools remained bounded at smoke 32, sparks 64, debris 24, with 0 active particles after reset;
- race state returned to lap 1 with 22 cars.

The diagnostics expose counts rather than Three.js/Web Audio object references, keeping tests independent of renderer internals.

## Limitations and notes

- Mobile verification is Chromium device emulation at 390×844 with DPR 3, touch, and mobile layout enabled; no physical iOS or Android device was profiled.
- Performance sampling covered race start and a deterministic advanced state, not separately forced pit-congestion, safety-car, and multi-incident scenes.
- The build's main JavaScript chunk exceeds Vite's 500 kB advisory threshold. Future work could split the 3D scene/asset loaders from the initial HUD shell.
- Vitest under Node 25 prints a benign jsdom `--localstorage-file` warning in several workers. It does not occur in browser E2E and did not affect the 100 passing unit tests.
- Existing visual references remain in `artifacts/task-11-desktop.png`, `artifacts/task-11-tablet.png`, and `artifacts/task-11-mobile.png`; Task 13 generated failure-only screenshots during development but retained no new screenshot because the final run was clean.
- No deployment, publishing, push, or pull request was performed.
