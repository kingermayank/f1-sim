# Task 10 Report: Camera Director and Manual Cameras

## Implemented

- Added a pure deterministic broadcast director covering start, finish, major/minor incidents, overtakes, pit activity, close on-track gaps, fastest laps, and routine running.
- Enforced a 3-second normal minimum and 10-second maximum shot duration. Finish and major incidents may interrupt after 1 second.
- Reduced-motion mode holds normal shots for 5 seconds and urgent shots for 2 seconds while retaining the 10-second maximum.
- Added deterministic camera-anchor progression and event/driver subject selection.
- Added broadcast, chase, cockpit, overhead, and free camera modes in React Three Fiber.
- Broadcast mode uses Monaco camera anchors and damped look targets; chase and cockpit track the selected driver; overhead frames the complete circuit; free mode uses damped OrbitControls.
- Manual modes do not run automatic broadcast cuts. Returning to broadcast resumes the director.
- Reused mutable vectors inside `useFrame`; track sampling and camera-pose allocations happen outside the frame loop.
- Review fix: added an independent monotonic `lastSeenEventTick` watermark so consumed urgent events cannot reappear after routine coverage.
- Review fix: overhead height now derives from circuit bounds, vertical FOV, live viewport aspect ratio, and a 12% framing margin.
- Review fix: camera tracking reads an immutable 1,024-step spline cache into reusable numeric scratch state from a store subscription. React no longer subscribes to each race snapshot, and no spline/vector/quaternion sample is allocated per published tick.
- Integrated `RaceCameras` into `RaceScene`. No HUD work was added.

## TDD Evidence

- Director test was first observed failing because `src/cameras/camera-director.ts` did not exist.
- Scene pose test was first observed failing because `src/cameras/RaceCameras.tsx` did not exist.
- Review regressions were first observed failing for stale incident replay, event-watermark ordering, missing overhead-fit helpers, and missing cached sampling.
- Focused result after review fixes: 2 test files passed, 20 tests passed.

## Verification

- `npm test -- tests/simulation/camera-director.test.ts tests/ui/race-scene.test.tsx` — passed (20/20).
- `npm run build` — passed (TypeScript and Vite production build).
- Chrome browser smoke at 1280×800 — passed: one WebGL canvas, accessible race viewport and heading present, no page errors or failed responses.
- `git diff --check` — passed.

## Notes

- Vite retains the existing large-chunk advisory for the Three.js bundle; it is non-fatal and outside Task 10 scope.
- Playwright's bundled Chromium was absent, so the browser smoke used the installed Google Chrome executable through Playwright.
