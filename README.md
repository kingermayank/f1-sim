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

## The garage (homepage)

The homepage is a showroom: the car turns on a polished turntable in a lit room, the driver sits on the left, and a glass card on the right holds four tabs.

- **Car**: the seven team liveries (keys `1`–`7`, `‹ ›` cycle every driver), the car's pattern and finish, wing mode (`G`, Corner or Straight; the flaps really move) and tyre compound (`T`). `Space` stops or starts the turntable.
- **Driver**: the team's two drivers and their ratings. Teammates differ by number and camera-pod colour.
- **Race**: circuit, laps and AI pace.
- **Share**: a rendered 1920×1080 picture from four angles (Front, Side, Rear, Above), with Copy link, Save picture (`P`), Copy picture and Share…. The link (`L`) carries the car in the address, e.g. `#/?d=leclerc&t=soft&w=corner&a=front`, and opens that exact car.

Changing car never swaps a model. A sphere grows from the nose tip at 3.4 m/s carrying the new paint, number and finish over the car behind a thin glowing shell. The circuit button bottom-left draws Shanghai from the simulation's centreline; its dot laps at a modelled pace (braking into corners) while the sector chips light purple, green and yellow. Pressing it runs the five start lights and the race begins.

The room renders through a multisampled chain with ambient occlusion and bloom. A governor watches the frame rate and drops ambient occlusion, then bloom and reflections, then resolution, on slower GPUs. Touch devices get a lighter path from the start.

## The car

The car is drawn in code (`src/car`) to the 2026 rules: a 3.4 m wheelbase, 1.9 m across, 18-inch wheels and a halo. The bodywork is lofted through superellipse cross-sections smoothed with monotone cubics, and the wings are cambered aerofoils. Liveries are computed in the paint shader from car-space position, so a stripe runs from the nose over the sidepods without a seam. The same geometry, at a lighter detail level for distant rivals, races in the game.

## Driving the race

Press **Start race** in the garage to drive the car you built from the back of a ten-car grid.

- **Controls**: `W`/`↑` throttle, `S`/`↓`/`Space` brake, `A`/`D` or `←`/`→` steer, `Shift` DRS where it is open, `R` reset to the track, `P`/`Esc` pause, `Enter` skip the intro, `H` show or hide the key bar. A gamepad and touch controls work too.
- **HUD**: glass cards in the garage's design language. Top left: position, lap, the running lap time with its delta to your best, live sector times and the gaps ahead and behind. Top right: the running order. Bottom left: the circuit map, sector by sector, with every car on it. Bottom right: the dash, with shift lights, gear, speed, pedal bars and the DRS and assist lights. Race events (passes, fastest laps, track limits) appear briefly in the middle.
- **Start**: the rivals keep their grid lanes and race normally from lights out; nobody moves aside. Your launch is traction limited like theirs, so you don't run into the car ahead.
- **Assists** follow the pace setting: on Easy and Medium, braking and line aids slow you for the next corner and keep you off the barrier, and their lights show on the dash when they act. Hard has none.
- **Feel**: the car sits on the road surface without floating or sinking, body roll and pitch are restrained, steering lock is limited to what the tyres can grip, and the grass is slow but not a trap.
- **Effects**: the tyres show their sidewall lettering, which blurs with speed, and the rims cross-fade to a motion-blurred disc so the wheels never strobe. Brake discs glow under hard braking, the floor throws sparks at speed and over kerbs, the rear tyres raise dust off the road, and the camera shakes over kerbs and in contact.
- **Sound**: the engine is a physical model of the 1.6 L turbo V6 (`src/game/audio`), running in an AudioWorklet. Six cylinders fire through modelled exhaust and intake pipes. You hear ignition cuts on upshifts, blips on downshifts, crackle on the overrun, the rev limiter, the turbo and the MGU-K. The nearest rival is a second copy of the model heard from outside, panned and Doppler-shifted. Wind, tyre scrub and the start lights layer on top.

## The circuit

Both races (the one you drive and the broadcast simulation) run on the APEX Shanghai circuit, built in Blender from the same centreline the cars drive on:

- **Track**: a high-resolution racing surface with a rubbered line, braking marks, track-limit lines, grid boxes and a chequered timing line, all computed in shaders; flat red and white kerbs through the corners; run-off of grass, gravel, or asphalt painted as at Shanghai (a blue stripe by the kerb, then green), each where the exit speed calls for it.
- **Barriers**: concrete walls wrapped in APEX banners, amber and graphite energy-absorbing blocks on the outside of fast corners, and chain-link debris fencing on steel posts. The barrier a car hits in the game is the barrier it sees: the physics reads the same layout per side, row by row.
- **Shanghai's landmarks**: the details people recognise from TV, from photos and survey data of the real circuit. Two silver lens-shaped "wing" pods span the start straight and pit lane, each 150 m long and about 36 m up. Each rests on a glossy red drum behind the grandstand and a round glass tower behind the garages. The 400 m main grandstand has three tiers, a red, orange, yellow and white seat mosaic, and one flat roof cantilevered over every seat, dotted underneath with lantern lights. Stand K lines the end of the back straight under white lotus-leaf umbrellas.
- **Grandstands**: besides those, five corner grandstands with shell roofs, grass spectator banks, about 60,000 spectators in their own colours, big screens and hospitality marquees.
- **Pit and paddock**: a pit lane with entry and exit roads, a pit building with team garages and signage, a canopy roof and terraces, and team stands on the pit wall. Behind it, as at Shanghai, a paved boulevard and a lake with 26 team pavilions on stilts, joined by zig-zag walkways, with willow islands. There is also a car park.
- **Trackside**: the start gantry, whose five lights count up with the race start; bridges over the straights; marshal posts; TV camera towers; braking distance, DRS and corner number boards; billboards.
- **Surroundings**: terrain with a lake, woods and copses. On the horizon are the estates of 20–30 storey residential towers and car-industry sheds around Anting; central Shanghai's skyline is 30 km away, so it doesn't appear. All of it sits under a sky rendered in Blender (a physically based atmosphere with cumulus) whose sun is exactly where the game's sun light shines from. The sky is also what the cars and glass reflect.

To rebuild it: `node scripts/circuit/build-circuit.mjs` lays the circuit out from the centreline, renders the posters, models it in Blender, compresses it, and renders the sky. It needs Blender (set `BLENDER` to its executable, or `BLENDER_PYTHON` to a Python 3.13 with `pip install bpy`). The results are `public/assets/models/circuit/shanghai-apex.glb` and `public/assets/textures/sky/shanghai-sky.webp`; the layout the game reads is `src/track/generated/shanghai-circuit-layout.json`.

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

The APEX Shanghai circuit and its sky (built by `scripts/circuit/`), the shared open-wheel car and the abstract livery textures (generated by `scripts/generate-race-assets.mjs`) are project-original CC0 assets. They contain no copied logos, team word marks, driver identifiers, or third-party geometry. The full machine-readable provenance manifest is `src/assets/credits.json`; the in-app **Credits** dialog displays it along with the simulation disclosure. Trademark handling is documented in `public/assets/TRADEMARKS.md`.

`npm run verify:assets` checks that every declared runtime asset exists, are uniquely listed, stay within size limits, have valid metadata, and contain semantically loadable GLB/WebP data.

## Mobile and quality behavior

At widths below 900 px or with a coarse pointer, automatic quality selects the mobile tier: device pixel ratio is capped at 1, shadows are disabled, procedural cars replace textured model clones, and distant scenery is reduced. Users can override **Auto** with **High** or **Low** detail.

At 760 px and below, the timing tower becomes an explicit drawer, controls scroll horizontally, the telemetry panel is compact, and the visual circuit map is hidden to preserve the race view. Its semantic 22-driver position list remains available to assistive technology. Touch targets retain a minimum height of 44 px.

## Delivery diagnostics

Development and Playwright `e2e` builds can opt into a narrow diagnostics boundary with `?diagnostics=1`. It reports race phase/tick/car count, live canvas count, bounded effect-pool capacity/activity, and owned audio node/source counts. It also provides explicit advance/finish commands used to test the terminal 78-lap flow without waiting for real presentation time. The boundary is disabled in normal production builds and does not expose or mutate engine internals directly.

The browser suite runs at 1440×900 and 390×844. It verifies ready/load state, all 22 drivers, follow/select, every camera, pause, every speed, seed actions, credits, persistence, mobile drawer/map semantics, accelerated finish, five restart cycles, and clean console/page/network logs.

## Future player-controller boundary

The spectator release has no player-controlled car. A future controller should be an adapter beside the simulation engine, not input logic inside React or Three.js. It should translate steering, throttle, braking, and recovery into the same per-tick vehicle-state contract currently produced for an AI driver. The engine remains authoritative for timing, lap/sector boundaries, flags, pits, collisions, and classification; the other 21 drivers continue through the existing AI/rules pipeline. Cameras, audio, effects, HUD selectors, and rendering keep consuming immutable snapshots and race events unchanged.

That boundary preserves deterministic replays: player input must be recorded as a tick-indexed input stream and included with the seed/configuration when replaying a player race.
