# Monaco 2026 Simulation

A browser-based spectator simulation of a 78-lap Monaco race with the complete 2026 grid: 11 teams and 22 drivers. A deterministic fixed-step TypeScript engine owns race timing and results; React renders the broadcast interface, and React Three Fiber presents the low-poly circuit and cars.

This is an independent private prototype. It is not affiliated with or endorsed by Formula 1, the FIA, the Monaco Grand Prix, its teams, or drivers.

## Requirements and setup

- Node.js 20.19+ or 22.12+
- npm
- A WebGL-capable current browser

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Audio starts muted because browsers require a user gesture before Web Audio can begin.

Useful commands:

```bash
npm test                 # complete Vitest suite, including the 200-seed soak
npm run verify:assets    # manifest, license, GLB, and WebP validation
npm run build            # strict TypeScript check and production bundle
npm run test:e2e         # desktop and mobile Chromium delivery checks
npm run generate:assets  # regenerate project-original runtime assets
```

Playwright uses its matching cached Chromium when present. On macOS it falls back to an installed Google Chrome, so it does not download a duplicate browser. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome` to use another local Chromium executable. Only if neither is available, install the matching runtime once with `npx playwright install chromium`.

## Race controls

- **Pause / Resume** freezes or resumes authoritative simulation time.
- **Speed** selects 1×, 2×, 4×, or 8× presentation speed. The default six-minute race takes about 45 seconds at 8×.
- **Restart** returns the current seed to lap 1.
- **Replay** reruns the same seed and therefore reproduces the same race.
- **New seed** starts a different deterministic race.
- Select any driver in the timing tower to follow them and populate the telemetry panel.
- **Labels**, **FX**, **Audio**, **Motion**, and **Quality** control presentation only; none changes the simulated result.

Restart, replay, and new-seed actions ask for confirmation after the race has progressed beyond lap 1. Presentation preferences and the selected camera persist in local storage under `monaco-race.preferences.v1`.

## Cameras

- **Broadcast** automatically ranks race events and cuts among circuit anchors.
- **Chase** follows the selected driver from behind.
- **Cockpit** follows the selected driver from a close forward-looking view.
- **Overhead** frames the complete circuit.
- **Free** enables orbit controls around the scene.

If no driver is selected, car-following cameras use the current leader. Reduced motion limits automatic cuts and incident presentation.

## Seeds and simulation model

The race engine advances in fixed 0.1-second simulation ticks. Rendering reads immutable snapshots and cannot alter outcomes, so the same configuration and seed produce the same events and final classification regardless of browser frame rate.

Every race covers 78 laps. Pace, tire wear, pit strategy, passing decisions, mistakes, contact, mechanical retirement, weather state, and safety-car periods live in pure TypeScript modules under `src/simulation`. The default is a sunny Mediterranean afternoon with incidents and safety cars enabled. Results are fictional and dynamically simulated rather than a recording of an official race.

The seed appears in the top bar on desktop and in the finish summary. Use **Replay** to reproduce it exactly or **New seed** to generate a new value.

## Assets and credits

The circuit model, shared open-wheel car, and eleven abstract livery textures are project-original CC0 assets generated locally by `scripts/generate-race-assets.mjs`. They contain no copied logos, team word marks, driver identifiers, or third-party geometry. The full machine-readable provenance manifest is `src/assets/credits.json`; the in-app **Credits** dialog displays it along with the simulation disclosure. Trademark handling is documented in `public/assets/TRADEMARKS.md`.

`npm run verify:assets` checks that all 13 declared runtime assets exist, are uniquely listed, stay within size limits, have valid metadata, and contain semantically loadable GLB/WebP data.

## Mobile and quality behavior

At widths below 900 px or with a coarse pointer, automatic quality selects the mobile tier: device pixel ratio is capped at 1, shadows are disabled, procedural cars replace textured model clones, and distant scenery is reduced. Users can override **Auto** with **High** or **Low** detail.

At 760 px and below, the timing tower becomes an explicit drawer, controls scroll horizontally, the telemetry panel is compact, and the visual circuit map is hidden to preserve the race view. Its semantic 22-driver position list remains available to assistive technology. Touch targets retain a minimum height of 44 px.

## Delivery diagnostics

Development and Playwright `e2e` builds can opt into a narrow diagnostics boundary with `?diagnostics=1`. It reports race phase/tick/car count, live canvas count, bounded effect-pool capacity/activity, and owned audio node/source counts. It also provides explicit advance/finish commands used to test the terminal 78-lap flow without waiting for real presentation time. The boundary is disabled in normal production builds and does not expose or mutate engine internals directly.

The browser suite runs at 1440×900 and 390×844. It verifies ready/load state, all 22 drivers, follow/select, every camera, pause, every speed, seed actions, credits, persistence, mobile drawer/map semantics, accelerated finish, five restart cycles, and clean console/page/network logs.

## Future player-controller boundary

The spectator release has no player-controlled car. A future controller should be an adapter beside the simulation engine, not input logic inside React or Three.js. It should translate steering, throttle, braking, and recovery into the same per-tick vehicle-state contract currently produced for an AI driver. The engine remains authoritative for timing, lap/sector boundaries, flags, pits, collisions, and classification; the other 21 drivers continue through the existing AI/rules pipeline. Cameras, audio, effects, HUD selectors, and rendering keep consuming immutable snapshots and race events unchanged.

That boundary preserves deterministic replays: player input must be recorded as a tick-indexed input stream and included with the seed/configuration when replaying a player race.
