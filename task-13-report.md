# Task 13 — Browser Verification, Performance, and Delivery Readiness

Date: 2026-08-05

Branch: `feat/f1-simulation`
Environment: macOS 15.5, Apple Silicon, Node.js 25.2.1, npm 11.13.0, Playwright 1.62.1, system Google Chrome 151.0.7922.75 (headless)

## Delivered

- Added a production-build Playwright server owned and shut down by Playwright. Its `e2e` build is written to a private temporary directory and served on TCP 5189, preventing concurrent production builds or the user-visible development server on TCP 5173 from changing the app under test. It uses an existing matching Playwright Chromium when available, then an explicit local executable, then installed macOS Google Chrome; it does not download browsers automatically.
- Added 1440×900 desktop Chromium and 390×844 mobile Chromium projects.
- Added ten total E2E executions covering an exact successful ready state, selection of every one of the 22 drivers through visible timing-tower UI, all five camera modes, pause/resume, 0.25×/0.5×/1×/2×/4×/8×, restart/replay/new seed, credits, local preference persistence, mobile timing drawer/map semantics, accelerated 78-lap finish, deterministic pit/safety-car/incident scenarios, five-restart steady state, and browser error collection. The scene exposes 22 driver controls; the selected Kimi Antonelli state is cross-checked between the visible timing control and scene control.
- Added a narrow `?diagnostics=1` development/e2e boundary for deterministic restart/advance/finish and safe race/scenario/canvas/audio/effect inspection. It is disabled in normal production builds.
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
| `npm run build` | TypeScript + Vite build passed | wall 1.08s |
| `npm run test:e2e` | 10/10 passed across both projects | Playwright 55.2s; wall 55.98s |
| Isolated 200-seed soak | 200/200 complete 22-car, 78-lap races; zero invariant failures | test 113.89s; wall 116.08s |
| Server cleanup | Playwright TCP 5189 stopped; user TCP 5173 intentionally left running | passed |
| Diff hygiene | `git diff --check` | passed |

The production bundle contains 685 transformed modules. Main output is 1,332.62 kB raw / 368.62 kB gzip. Vite reports its advisory for a chunk over 500 kB; this is a delivery limitation, not a build failure. No manual chunking or lazy-loading change was added in this correction because doing so safely requires changing scene/UI import boundaries outside the delivery-test scope.

## Browser error gate

Every E2E test collected browser console errors, uncaught page errors, failed requests, and HTTP responses with status 400 or higher. Asset fetch failures retain the exact failed URL in the attached diagnostics, and a procedural fallback is treated as a readiness failure rather than a passing substitute. The final combined run recorded zero in every category on desktop and mobile.

## Performance samples

Frame timing uses `requestAnimationFrame` over two-second windows in headless Chrome. “Advanced” means the deterministic diagnostics boundary advanced the live race by 150 presentation seconds before sampling.

| Viewport | Start | Advanced | Target |
|---|---:|---:|---:|
| 1440×900 desktop | 114.0 FPS, 16.1ms p95 | 118.0 FPS, 9.2ms p95 | 60 FPS |
| 390×844 mobile emulation | 120.0 FPS, 9.2ms p95 | 120.0 FPS, 9.3ms p95 | 30 FPS |

These are approximate main-thread presentation timings on a desktop machine, not GPU telemetry from a physical phone. Both clear the requested thresholds, so no scene-quality reductions were made. A deterministic safety-car checkpoint was also sampled in both projects at 120.0 FPS with 9.2ms p95 in the final combined run.

## Five-restart steady state

The resource scenario ran independently in both projects, for ten restart cycles total. After each of five restarts per viewport it verified:

- exactly one live canvas;
- the independently instrumented active window-listener count was unchanged from the warmed post-load baseline;
- audio remained at one running context graph with 10 owned nodes, 4 owned sources, and 0 transient nodes;
- effect pools remained bounded at smoke 32, sparks 64, debris 24, with 0 active particles after reset;
- browser-observed active WebGL buffer, texture, program, framebuffer, and renderbuffer counts remained unchanged after one-time lazy allocation warm-up;
- browser-observed WebGL draw calls continued after every restart;
- race state returned to lap 1 with 22 cars.

Three.js `renderer.info` is not exposed by the application boundary. The test therefore observes the corresponding WebGL create/delete and draw APIs without taking references to Three.js renderer objects; these are browser-level resource counters, not a claim of direct `renderer.info.memory` telemetry.

## Limitations and notes

- Mobile verification is Chromium device emulation at 390×844 with DPR 3, touch, and mobile layout enabled; no physical iOS or Android device was profiled.
- Deterministic correctness checks force and replay active pit, safety-car, and incident states. Performance timing additionally covers the safety-car checkpoint, but it does not separately benchmark a deliberately congested pit lane or a forced simultaneous multi-car incident render state.
- The build's main JavaScript chunk exceeds Vite's 500 kB advisory threshold. Future work could split the 3D scene/asset loaders from the initial HUD shell.
- Vitest under Node 25 prints a benign jsdom `--localstorage-file` warning in several workers. It does not occur in browser E2E and did not affect the 100 passing unit tests.
- Existing visual references remain in `artifacts/task-11-desktop.png`, `artifacts/task-11-tablet.png`, and `artifacts/task-11-mobile.png`; Task 13 generated failure-only screenshots during development but retained no new screenshot because the final run was clean.
- No deployment, publishing, push, or pull request was performed.
