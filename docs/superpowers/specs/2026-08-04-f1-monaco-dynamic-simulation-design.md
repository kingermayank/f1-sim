# F1 Monaco Dynamic Simulation Design

## Summary

Build a browser-based, cinematic low-poly Formula 1 race simulation inspired by the referenced Bay Area transit visualization. The initial release simulates a compressed Monaco race with the complete 2026 grid: 11 teams, 22 drivers, and 78 displayed laps completed in approximately five to eight minutes.

The race is dynamic rather than a fixed replay. Driver and team performance is influenced by the 2026 Monaco result, while pit strategies, overtakes, mistakes, incidents, retirements, safety-car periods, and the final classification may vary between runs. A seeded random generator makes each run reproducible.

The architecture must allow a later iteration to replace one AI driver with a player-controlled car without rewriting the remaining race simulation.

## Product Goals

- Deliver a visually polished, understandable race simulation in one strong initial build.
- Simulate all 22 official 2026 drivers and 11 teams.
- Make strategy, position changes, timing gaps, incidents, and tire states visible and believable.
- Present Monaco as a cinematic low-poly environment with recognizable elevation and scenery.
- Maintain stable desktop performance and a simplified mobile presentation.
- Use only free assets with licenses compatible with the project.
- Preserve clean boundaries between simulation logic, rendering, interface, and assets.

## Non-Goals for the Initial Release

- Full vehicle dynamics or engineering-grade tire physics.
- Exact reproduction of official lap-by-lap telemetry.
- Photorealistic rendering.
- Direct player control of a car.
- Exact replication of Formula 1's proprietary broadcast graphics.
- Guaranteed reproduction of the official 2026 Monaco finishing order.

## Core Experience

The application opens on an aerial view of Monaco and transitions to the starting grid. The user can watch the simulation under an automatic broadcast camera or follow any driver using chase, cockpit, overhead, or free-camera modes.

The race displays 78 laps but advances faster than real time. The default presentation completes in approximately five to eight minutes. The user can pause or select 1x, 2x, 4x, or 8x playback. Restarting creates a new seed and a new race outcome. Replaying a saved seed reproduces the same outcome.

The initial release is a spectator experience. The interaction and simulation boundaries must permit a later player-controller module to take ownership of one car while the other 21 remain AI-controlled.

## Technical Architecture

### Application Stack

- React and TypeScript for the application shell and interface.
- React Three Fiber and Three.js for 3D rendering.
- A pure TypeScript deterministic simulation engine.
- A small client-side state store for selected driver, cameras, playback, display settings, and derived race presentation state.
- GLB assets optimized for browser delivery.
- Human-readable TypeScript or JSON configuration for teams, drivers, track metadata, and simulation tuning.

### Module Boundaries

1. **Race engine**
   - Owns authoritative race time and state.
   - Advances with a fixed simulation step.
   - Has no dependency on React, Three.js, or browser frame rate.
   - Accepts a race configuration and seed and emits immutable snapshots or events.

2. **Track model**
   - Owns the centerline, alternate racing lines, pit lane, sectors, timing line, grid positions, overtaking zones, marshal zones, and camera anchors.
   - Converts normalized circuit distance to world position and orientation.
   - Is replaceable without changing race rules.

3. **Vehicle presentation**
   - Maps simulated circuit position, line choice, and incident state onto car transforms and animations.
   - Owns wheel rotation, steering, suspension movement, contact reactions, smoke, sparks, and lightweight debris.
   - Does not determine race outcomes.

4. **Environment renderer**
   - Loads the Monaco environment and adds water, lighting, scenery, crowds, and atmospheric effects.
   - Applies desktop or mobile quality settings.

5. **Camera director**
   - Owns broadcast shot selection and manual camera modes.
   - Consumes race events such as battles, overtakes, pit stops, incidents, and finishes.

6. **Timing and control interface**
   - Displays race state and accepts spectator controls.
   - Selects drivers and cameras but does not mutate authoritative results.

7. **Asset registry**
   - Maps logical asset identifiers to optimized files, attribution, license, and fallbacks.

### Data Flow

```text
Race configuration + driver ratings + strategy + seed
                         |
                         v
              Fixed-step race engine
                         |
                         v
       Race snapshot + ordered event stream
              /                    \
             v                      v
     Three.js presentation     Timing/UI state
```

Rendering interpolates between fixed simulation snapshots. A slow rendering frame must not change the simulated result.

## Track and Asset Strategy

### Monaco Track

The initial candidate is the free Sketchfab model “Monaco GP racetrack” by narlankaaditya:

- Source: https://sketchfab.com/3d-models/monaco-gp-racetrack-ebb9b9a0c19e4801815b19c55d14dea3
- License: Creative Commons Attribution.
- Approximate complexity: 19,300 triangles and 11,600 vertices.
- Author describes it as a low-poly Monaco circuit with changeable road and wall materials and a matched elevation gradient.

Before use, verify the downloaded archive, exact license file, geometry orientation, scale, UVs, material count, tunnel/path continuity, pit-lane usability, and attribution requirements. If this model is unusable, select another free circuit with compatible licensing; the race engine must remain track-agnostic.

### Cars

Use one free, optimized open-wheel base chassis and instantiate it for all 22 entries. The initial candidate is the CC0 “Low poly formula 1 car” from OpenGameArt:

- Source: https://opengameart.org/content/low-poly-formula-1-car
- License: CC0.

Create 11 team variants using material colors, permitted markings, driver numbers, and minor reusable geometry variations. Two cars per team receive their drivers' numbers and identifiers. Free exact 2026 car models are not required and must not be used unless their licenses are verified individually.

The private prototype will use the official 2026 team and driver names, team colors, driver numbers, and recognizable 2026 livery patterns recreated as original project textures. It must not copy texture files or geometry from unauthorized or paid models. Public release requires a separate branding and trademark review and may replace protected marks with simplified equivalents.

### Supporting Assets

Prefer CC0 or attribution-compatible sources for boats, vegetation, barriers, pit props, grandstands, and crowd elements. Generate simple buildings and repeated scenery procedurally where that improves performance and stylistic consistency.

Use generic synthesized engine, tire, crowd, pit, impact, and interface audio. Do not copy audio from broadcasts, games, or race footage.

### Asset Manifest

Record for every external asset:

- Title and creator.
- Original URL.
- License and attribution language.
- Download date.
- Original filename.
- Optimized local filename.
- Modifications made.
- Polygon, texture, and file-size budgets.

The finished application includes a visible credits panel.

## Race Configuration

The grid contains the official 2026 teams and drivers:

- Mercedes: George Russell and Kimi Antonelli.
- Ferrari: Charles Leclerc and Lewis Hamilton.
- McLaren: Lando Norris and Oscar Piastri.
- Red Bull Racing: Max Verstappen and Isack Hadjar.
- Racing Bulls: Liam Lawson and Arvid Lindblad.
- Alpine: Pierre Gasly and Franco Colapinto.
- Haas: Esteban Ocon and Oliver Bearman.
- Audi: Nico Hulkenberg and Gabriel Bortoleto.
- Williams: Carlos Sainz and Alexander Albon.
- Aston Martin: Fernando Alonso and Lance Stroll.
- Cadillac: Sergio Perez and Valtteri Bottas.

Each driver configuration contains:

- Name, abbreviation, number, nationality, team, and display color.
- Base race pace and qualifying pace.
- Consistency.
- Overtaking and defending ability.
- Tire management.
- Wet-weather ability.
- Incident risk.
- Reliability.
- Pit execution rating.

The 2026 Monaco result influences the ratings, including Kimi Antonelli's win, Lewis Hamilton's second place, and Pierre Gasly's third place. It does not force the same finishing order.

The application explicitly describes its generated timing as a simulation influenced by 2026 performance, not official telemetry.

## Simulation Model

### Time and Distance

- Advance authoritative state with a fixed simulation step.
- Track each car by lap, sector, distance along the circuit, lateral line choice, speed, and state.
- Derive elapsed race time, lap time, sector time, leader interval, and adjacent-car gaps from authoritative state.
- Scale simulation time to complete the displayed 78 laps in five to eight minutes at default presentation speed.

### Pace

Target pace combines:

- Driver and team base performance.
- Circuit sector characteristics.
- Tire compound, wear, and temperature.
- Fuel-load approximation.
- Traffic and dirty-air penalties.
- Slipstream benefit.
- Temporary mistakes or damage.
- Yellow-flag or safety-car constraints.
- Small seeded variation.

### Racing Lines and Battles

- Define a primary line and selected alternate lines in passing zones.
- A following car may attempt an overtake based on pace advantage, gap, driver ability, tire state, and track zone.
- The defending car may choose a defensive line with a pace cost.
- Failed attempts may produce time loss, lockups, contact risk, or a later retry.
- Position changes occur only after cars pass defined ordering checkpoints, preventing visual and timing disagreement.

### Tires and Pit Strategy

- Support at least soft, medium, and hard compounds.
- Model wear, temperature, grip, and pace degradation with simplified curves.
- Assign generated strategy plans that may adapt to traffic, incidents, tire state, or safety cars.
- Model pit entry, service duration variance, tire selection, pit exit, undercuts, and overcuts.

### Incidents and Reliability

Support:

- Lockups and temporary pace loss.
- Spins and recoverable off-line events.
- Light and race-ending contact.
- Mechanical issues and retirements.
- Yellow flags.
- Safety-car periods.
- Weather changes as a configurable event, although the default initial race is sunny.

Incidents are determined by seeded rules using proximity, line conflict, relative speed, driver risk, weather, and reliability. Visual vehicle reactions are cinematic approximations rather than authoritative rigid-body physics.

### Determinism

- A race seed determines qualifying/grid variation, strategies, pace noise, incidents, weather events, and outcomes.
- Running the same configuration and seed produces the same event stream and classification.
- Rendering frame rate cannot influence results.

## Visual Direction

Use a cinematic low-poly Monaco presentation:

- Warm Mediterranean afternoon lighting.
- Soft atmospheric haze.
- Saturated but controlled team colors.
- Clean shadows and restrained reflections.
- Harbor water, boats, grandstands, barriers, curbs, flags, city buildings, vegetation, and simplified crowds.
- Recognizable scenery without a photorealistic asset budget.

Enhance the source track with lightweight procedural scenery where necessary. If the track lacks a usable tunnel, create a simplified tunnel presentation aligned to the racing spline or select another free track asset.

Effects include restrained motion blur, speed streaks, tire smoke, sparks, debris, and camera shake. Reduced-motion mode disables or minimizes nonessential motion effects and aggressive camera transitions.

## Camera System

- **Broadcast:** automatic trackside shot selection driven by event priority.
- **Chase:** follows the selected driver from behind.
- **Cockpit:** low onboard view with restrained vibration and steering motion.
- **Overhead:** displays the full circuit and cars.
- **Free:** orbit, pan, and zoom.
- **Incident:** temporary cinematic framing for significant incidents, subject to user camera-lock settings.

Broadcast priorities include close battles, overtakes, pit stops, incidents, race start, final lap, and finish. Apply shot-duration limits and cooldowns to prevent frantic cutting.

The user can select a driver from the leaderboard or by clicking a car. Camera transitions are smooth and interruptible.

## Interface

### Desktop

- Left leaderboard with position, abbreviation, team color, interval, tire, pit status, fastest-lap marker, warnings, and DNF state.
- Top race bar with lap, flag, weather, elapsed simulation time, playback speed, and leader.
- Selected-driver panel with name, team, position, speed, last lap, best lap, sectors, tire wear, strategy, and condition.
- Circuit map with moving, color-coded car markers.
- Event feed for overtakes, stops, incidents, fastest laps, flags, and retirements.
- Playback controls for pause, resume, 1x, 2x, 4x, 8x, restart, new seed, and replay seed.
- Camera controls and display settings.

### Mobile

- Full-screen 3D view.
- Expandable compact leaderboard.
- Bottom strip for selected driver, playback, and camera controls.
- Reduced environmental detail and effects without changing race logic.

### Finish Screen

- Final classification.
- Winning time and intervals.
- Fastest lap.
- Pit-stop summary.
- Retirements and incident recap.
- Race seed.
- Replay and new-race actions.
- Asset credits and licenses.

### Accessibility

- Keyboard-operable controls.
- Readable contrast and scalable text.
- Reduced-motion setting.
- Status indicators that do not rely only on color.
- Text equivalents for important audio events.

## Performance Budgets

- Target 60 FPS at 1440x900 in a current desktop browser on a recent Apple Silicon or comparable laptop, and 30 FPS at approximately 390x844 on a recent iPhone or comparable Android device.
- Reuse one primary car geometry with lightweight material/livery variants.
- Compress GLB geometry and textures.
- Use instancing for repeated scenery.
- Use level-of-detail variants for buildings, spectators, and props.
- Limit real-time shadow casters and reflection cost.
- Pool smoke, sparks, debris, labels, and transient markers.
- Reduce shadows, reflections, crowds, environment detail, particles, and post-processing on mobile.

The simulation engine runs independently of visual quality settings.

## Resilience and Error Handling

- Validate race, driver, team, strategy, and track configuration before starting.
- Replace missing optional scenery or car presentation assets with visible fallbacks.
- If the required track or racing path fails, stop and show a recovery screen rather than running an invalid race.
- Prevent retired cars from re-entering or finishing.
- Prevent duplicate or missing drivers.
- Keep timing and ordering based on authoritative simulation checkpoints, not visual proximity alone.
- Surface asset-loading and configuration errors in development diagnostics without exposing technical noise in the user interface.

## Verification Strategy

### Race Engine Tests

- Same seed and configuration produce identical events and results.
- Different seeds produce meaningfully different strategies and classifications.
- All 22 drivers appear exactly once.
- Lap, sector, position, gap, and interval calculations remain consistent.
- Cars follow valid racing or pit paths.
- Pit stops change tires and apply time loss correctly.
- Retired cars cannot finish.
- Safety cars compress gaps and control pace correctly.
- Overtake checkpoints keep timing and visual order aligned.
- Accelerated headless simulations complete without invalid states.

### Presentation Tests

- Car transforms stay aligned to the circuit at supported playback speeds.
- Every camera mode can select every active driver.
- Broadcast camera cooldowns prevent excessive cutting.
- Labels remain readable and do not create severe overlap in primary views.
- Effects are pooled and do not grow memory usage over repeated races.

### Interface and Accessibility Tests

- Mouse, keyboard, and touch can operate primary controls.
- Desktop and mobile layouts remain usable at target breakpoints.
- Reduced-motion and non-color status modes work.
- Finish classification matches authoritative engine state.
- Credits include every shipped external asset and required attribution.

### Performance Tests

- Test the full 22-car grid on representative desktop and mobile profiles.
- Verify sustained frame rate during the race start, pit congestion, safety-car bunching, and multi-car incidents.
- Verify repeated race restarts do not leak GPU resources or event listeners.

## Future Interactive Iteration

Add a player-controller adapter that replaces one AI driver. The adapter translates steering, throttle, braking, and recovery state into the same vehicle-state interface consumed by timing and presentation systems. AI, strategy, timing, cameras, event feeds, and the other 21 cars remain unchanged.

The first release does not implement this controller, but it must avoid assumptions that every car is always AI-authored.

## Delivery

The first deliverable is a polished local prototype. Public hosting occurs only after visual, performance, licensing, and branding review.
