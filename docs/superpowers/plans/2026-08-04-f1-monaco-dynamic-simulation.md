# F1 Monaco Dynamic Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished browser-based, seeded, dynamic 78-lap Monaco race simulation with the complete 2026 Formula 1 grid, cinematic low-poly rendering, broadcast timing, strategy, incidents, cameras, mobile adaptation, audio, accessibility, and asset credits.

**Architecture:** A pure TypeScript fixed-step race engine owns authoritative timing and results. React presents controls and timing, while React Three Fiber interpolates immutable race snapshots onto a replaceable track spline and 22 lightweight car instances. Assets, camera direction, audio, and effects consume race events without mutating simulation outcomes.

**Tech Stack:** Vite, React, TypeScript, Three.js, React Three Fiber, Drei, Zustand, Zod, Vitest, Testing Library, Playwright, glTF/GLB, Web Audio API.

## Global Constraints

- Simulate all 11 official 2026 teams and 22 drivers exactly once.
- Display 78 Monaco laps in approximately five to eight minutes at default 1x presentation speed.
- Support pause, 1x, 2x, 4x, and 8x playback.
- The same seed and configuration must produce identical events and classification regardless of rendering frame rate.
- Use only free assets with individually verified licenses and a visible credits panel.
- Use official team and driver names in the private prototype; recreate livery textures locally and do not copy paid or unauthorized model assets.
- Default conditions are a sunny Mediterranean afternoon; weather remains a supported configurable event.
- Target 60 FPS at 1440x900 on a recent Apple Silicon or comparable laptop and 30 FPS near 390x844 on a recent iPhone or comparable Android device.
- The first release is a spectator simulation; module boundaries must permit one AI car to be replaced by a player controller later.
- Timing graphics may be motorsport-inspired but must not copy Formula 1's proprietary broadcast layout.
- Commit after every independently testable task.

## File Structure

```text
package.json                         dependency and script definitions
tsconfig.json                       strict TypeScript configuration
vite.config.ts                      Vite and Vitest configuration
playwright.config.ts                browser test configuration
src/main.tsx                        application entry
src/app/App.tsx                     application composition
src/app/styles.css                  global theme, layout, responsive rules
src/domain/race-types.ts            shared race, driver, team, event types
src/domain/grid-2026.ts             11 teams and 22 drivers
src/domain/race-config.ts           Zod validation and default configuration
src/simulation/prng.ts              deterministic random generator
src/simulation/pace.ts              pace calculation
src/simulation/tires.ts             tire state and degradation
src/simulation/strategy.ts          pit strategy generation and adaptation
src/simulation/overtakes.ts         attack and defense decisions
src/simulation/incidents.ts         mistakes, contact, failures, weather
src/simulation/race-engine.ts       authoritative fixed-step state machine
src/simulation/selectors.ts         classification and timing derivation
src/track/track-types.ts            track contract
src/track/spline-track.ts           distance-to-transform spline implementation
src/track/monaco-track.ts           Monaco sectors, grid, pit lane, racing lines
src/assets/asset-registry.ts        asset paths, license metadata, fallbacks
src/assets/credits.json             shipped asset manifest
src/store/race-store.ts             UI controls and engine integration
src/scene/RaceScene.tsx             R3F canvas and quality selection
src/scene/Environment.tsx           track, water, light, scenery
src/scene/CarField.tsx              22 car presentation instances
src/scene/RaceEffects.tsx           smoke, sparks, flags, reduced-motion rules
src/cameras/camera-director.ts      event-ranked automatic shot selection
src/cameras/RaceCameras.tsx         broadcast, chase, cockpit, overhead, free
src/audio/race-audio.ts             synthesized race audio and mute controls
src/ui/RaceHud.tsx                  complete desktop/mobile timing shell
src/ui/Leaderboard.tsx              ordered timing tower
src/ui/DriverPanel.tsx              selected-driver telemetry
src/ui/TrackMap.tsx                 SVG circuit and markers
src/ui/EventFeed.tsx                race event announcements
src/ui/PlaybackControls.tsx         pause, speed, seed, camera controls
src/ui/FinishScreen.tsx             classification and replay actions
src/ui/CreditsPanel.tsx             asset and data disclosures
tests/domain/grid-2026.test.ts       grid and configuration tests
tests/simulation/*.test.ts          deterministic race-rule tests
tests/track/spline-track.test.ts     track interpolation tests
tests/store/race-store.test.ts       playback integration tests
tests/ui/*.test.tsx                 UI and accessibility tests
tests/e2e/race.spec.ts              browser smoke and interaction tests
scripts/verify-assets.mjs           license/file manifest validation
public/assets/                       optimized licensed runtime assets
```

---

### Task 1: Application Shell and Test Harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/app/styles.css`
- Create: `tests/ui/app-shell.test.tsx`

**Interfaces:**
- Consumes: approved design specification only.
- Produces: `App(): JSX.Element`, Vite development/build scripts, Vitest DOM environment, Playwright web-server configuration.

- [ ] **Step 1: Scaffold the React TypeScript project and install runtime/test dependencies**

Run these commands in order:

```bash
npm init -y
npm install react react-dom three @react-three/fiber @react-three/drei zustand zod
npm install -D vite @vitejs/plugin-react typescript @types/node @types/react @types/react-dom @types/three vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event playwright @playwright/test
```

Expected: package installation succeeds and `npm run dev` is available.

- [ ] **Step 2: Add exact scripts and test configuration**

Set the scripts in `package.json` to:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "verify:assets": "node scripts/verify-assets.mjs"
  }
}
```

Configure `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
```

Configure `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vite/client", "vitest/globals", "node"],
    "jsx": "react-jsx"
  },
  "include": ["src", "tests", "vite.config.ts", "playwright.config.ts"]
}
```

- [ ] **Step 3: Write the failing shell test**

Create `tests/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

Create `tests/ui/app-shell.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { App } from '../../src/app/App';

it('renders the race title and loading status', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Monaco 2026 Simulation' })).toBeVisible();
  expect(screen.getByText('Preparing the grid')).toBeVisible();
});
```

- [ ] **Step 4: Run the test and verify failure**

Run: `npm test -- tests/ui/app-shell.test.tsx`

Expected: FAIL because `src/app/App.tsx` does not export the required shell.

- [ ] **Step 5: Implement the minimal accessible application shell**

```tsx
// src/app/App.tsx
import './styles.css';

export function App() {
  return (
    <main className="app-shell">
      <h1>Monaco 2026 Simulation</h1>
      <p role="status">Preparing the grid</p>
    </main>
  );
}
```

```tsx
// src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
```

```html
<!-- index.html -->
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Monaco 2026 Simulation</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

```css
/* src/app/styles.css */
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #07110f; color: #f6f4eb; }
* { box-sizing: border-box; }
html, body, #root { width: 100%; min-height: 100%; margin: 0; }
button, select { font: inherit; }
.app-shell { min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 50% 20%, #173c32, #07110f 65%); }
```

- [ ] **Step 6: Verify shell, build, and commit**

Run: `npm test -- tests/ui/app-shell.test.tsx`

Expected: PASS.

Run: `npm run build`

Expected: TypeScript and Vite build complete successfully.

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src tests
git commit -m "chore: scaffold F1 simulation app"
```

---

### Task 2: 2026 Grid and Validated Race Configuration

**Files:**
- Create: `src/domain/race-types.ts`
- Create: `src/domain/grid-2026.ts`
- Create: `src/domain/race-config.ts`
- Create: `tests/domain/grid-2026.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `TeamId`, `Driver`, `Team`, `RaceConfig`, `TEAMS_2026`, `DRIVERS_2026`, `DEFAULT_RACE_CONFIG`, `parseRaceConfig(input): RaceConfig`.

- [ ] **Step 1: Define the failing grid invariants**

```ts
// tests/domain/grid-2026.test.ts
import { DRIVERS_2026, TEAMS_2026 } from '../../src/domain/grid-2026';
import { DEFAULT_RACE_CONFIG, parseRaceConfig } from '../../src/domain/race-config';

it('contains 11 teams and 22 unique drivers', () => {
  expect(TEAMS_2026).toHaveLength(11);
  expect(DRIVERS_2026).toHaveLength(22);
  expect(new Set(DRIVERS_2026.map((driver) => driver.id)).size).toBe(22);
  expect(new Set(DRIVERS_2026.map((driver) => driver.number)).size).toBe(22);
});

it('assigns exactly two drivers to every team', () => {
  for (const team of TEAMS_2026) {
    expect(DRIVERS_2026.filter((driver) => driver.teamId === team.id)).toHaveLength(2);
  }
});

it('validates the 78-lap compressed default race', () => {
  expect(parseRaceConfig(DEFAULT_RACE_CONFIG)).toMatchObject({
    laps: 78,
    presentationMinutes: 6,
    weather: 'sunny',
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test -- tests/domain/grid-2026.test.ts`

Expected: FAIL with missing domain modules.

- [ ] **Step 3: Implement the domain contracts**

```ts
// src/domain/race-types.ts
export type TeamId =
  | 'mercedes' | 'ferrari' | 'mclaren' | 'red-bull' | 'racing-bulls'
  | 'alpine' | 'haas' | 'audi' | 'williams' | 'aston-martin' | 'cadillac';

export type TireCompound = 'soft' | 'medium' | 'hard' | 'intermediate' | 'wet';
export type Weather = 'sunny' | 'cloudy' | 'rain';

export interface Ratings {
  pace: number;
  qualifying: number;
  consistency: number;
  overtaking: number;
  defending: number;
  tireManagement: number;
  wetSkill: number;
  reliability: number;
  incidentAvoidance: number;
  pitExecution: number;
}

export interface Team { id: TeamId; name: string; color: string; accent: string }
export interface Driver {
  id: string;
  name: string;
  abbreviation: string;
  number: number;
  nationality: string;
  teamId: TeamId;
  ratings: Ratings;
}

export interface RaceConfig {
  seed: string;
  laps: 78;
  presentationMinutes: number;
  weather: Weather;
  safetyCars: boolean;
  incidents: boolean;
}
```

- [ ] **Step 4: Add the exact 2026 team and driver arrays**

```ts
// src/domain/grid-2026.ts
import type { Driver, Ratings, Team } from './race-types';

export const TEAMS_2026: readonly Team[] = [
  { id: 'mercedes', name: 'Mercedes', color: '#00A19C', accent: '#C8CCCE' },
  { id: 'ferrari', name: 'Ferrari', color: '#E80020', accent: '#FFF200' },
  { id: 'mclaren', name: 'McLaren', color: '#FF8000', accent: '#47C7FC' },
  { id: 'red-bull', name: 'Red Bull Racing', color: '#3671C6', accent: '#FCD700' },
  { id: 'racing-bulls', name: 'Racing Bulls', color: '#6692FF', accent: '#FFFFFF' },
  { id: 'alpine', name: 'Alpine', color: '#FF87BC', accent: '#2293D1' },
  { id: 'haas', name: 'Haas F1 Team', color: '#B6BABD', accent: '#E6002D' },
  { id: 'audi', name: 'Audi', color: '#F50537', accent: '#B7FF00' },
  { id: 'williams', name: 'Williams', color: '#1868DB', accent: '#00A0DE' },
  { id: 'aston-martin', name: 'Aston Martin', color: '#229971', accent: '#CEDC00' },
  { id: 'cadillac', name: 'Cadillac', color: '#C8A96B', accent: '#111111' },
];

const base: Ratings = {
  pace: 0.8, qualifying: 0.8, consistency: 0.8, overtaking: 0.8, defending: 0.8,
  tireManagement: 0.8, wetSkill: 0.8, reliability: 0.9, incidentAvoidance: 0.85, pitExecution: 0.85,
};
const rated = (overrides: Partial<Ratings>): Ratings => ({ ...base, ...overrides });

export const DRIVERS_2026: readonly Driver[] = [
  { id: 'russell', name: 'George Russell', abbreviation: 'RUS', number: 63, nationality: 'GBR', teamId: 'mercedes', ratings: rated({ pace: 0.93, qualifying: 0.94, consistency: 0.92 }) },
  { id: 'antonelli', name: 'Kimi Antonelli', abbreviation: 'ANT', number: 12, nationality: 'ITA', teamId: 'mercedes', ratings: rated({ pace: 0.96, qualifying: 0.94, consistency: 0.91, overtaking: 0.92 }) },
  { id: 'leclerc', name: 'Charles Leclerc', abbreviation: 'LEC', number: 16, nationality: 'MON', teamId: 'ferrari', ratings: rated({ pace: 0.94, qualifying: 0.98, defending: 0.91 }) },
  { id: 'hamilton', name: 'Lewis Hamilton', abbreviation: 'HAM', number: 44, nationality: 'GBR', teamId: 'ferrari', ratings: rated({ pace: 0.95, consistency: 0.94, tireManagement: 0.97, wetSkill: 0.98 }) },
  { id: 'norris', name: 'Lando Norris', abbreviation: 'NOR', number: 1, nationality: 'GBR', teamId: 'mclaren', ratings: rated({ pace: 0.93, qualifying: 0.93, consistency: 0.92 }) },
  { id: 'piastri', name: 'Oscar Piastri', abbreviation: 'PIA', number: 81, nationality: 'AUS', teamId: 'mclaren', ratings: rated({ pace: 0.92, consistency: 0.93, tireManagement: 0.92 }) },
  { id: 'verstappen', name: 'Max Verstappen', abbreviation: 'VER', number: 3, nationality: 'NED', teamId: 'red-bull', ratings: rated({ pace: 0.96, qualifying: 0.96, overtaking: 0.97, defending: 0.97, wetSkill: 0.98 }) },
  { id: 'hadjar', name: 'Isack Hadjar', abbreviation: 'HAD', number: 6, nationality: 'FRA', teamId: 'red-bull', ratings: rated({ pace: 0.9, qualifying: 0.89, overtaking: 0.9 }) },
  { id: 'lawson', name: 'Liam Lawson', abbreviation: 'LAW', number: 30, nationality: 'NZL', teamId: 'racing-bulls', ratings: rated({ pace: 0.86, defending: 0.88, incidentAvoidance: 0.8 }) },
  { id: 'lindblad', name: 'Arvid Lindblad', abbreviation: 'LIN', number: 41, nationality: 'GBR', teamId: 'racing-bulls', ratings: rated({ pace: 0.84, qualifying: 0.86, incidentAvoidance: 0.76 }) },
  { id: 'gasly', name: 'Pierre Gasly', abbreviation: 'GAS', number: 10, nationality: 'FRA', teamId: 'alpine', ratings: rated({ pace: 0.91, qualifying: 0.9, consistency: 0.9, tireManagement: 0.91 }) },
  { id: 'colapinto', name: 'Franco Colapinto', abbreviation: 'COL', number: 43, nationality: 'ARG', teamId: 'alpine', ratings: rated({ pace: 0.82, overtaking: 0.85, incidentAvoidance: 0.76 }) },
  { id: 'ocon', name: 'Esteban Ocon', abbreviation: 'OCO', number: 31, nationality: 'FRA', teamId: 'haas', ratings: rated({ pace: 0.82, defending: 0.87, consistency: 0.84 }) },
  { id: 'bearman', name: 'Oliver Bearman', abbreviation: 'BEA', number: 87, nationality: 'GBR', teamId: 'haas', ratings: rated({ pace: 0.85, qualifying: 0.85, overtaking: 0.86 }) },
  { id: 'hulkenberg', name: 'Nico Hulkenberg', abbreviation: 'HUL', number: 27, nationality: 'GER', teamId: 'audi', ratings: rated({ pace: 0.84, qualifying: 0.88, consistency: 0.86 }) },
  { id: 'bortoleto', name: 'Gabriel Bortoleto', abbreviation: 'BOR', number: 5, nationality: 'BRA', teamId: 'audi', ratings: rated({ pace: 0.83, tireManagement: 0.84, incidentAvoidance: 0.82 }) },
  { id: 'sainz', name: 'Carlos Sainz', abbreviation: 'SAI', number: 55, nationality: 'ESP', teamId: 'williams', ratings: rated({ pace: 0.88, consistency: 0.91, tireManagement: 0.92 }) },
  { id: 'albon', name: 'Alexander Albon', abbreviation: 'ALB', number: 23, nationality: 'THA', teamId: 'williams', ratings: rated({ pace: 0.86, qualifying: 0.88, overtaking: 0.87 }) },
  { id: 'alonso', name: 'Fernando Alonso', abbreviation: 'ALO', number: 14, nationality: 'ESP', teamId: 'aston-martin', ratings: rated({ pace: 0.87, consistency: 0.94, overtaking: 0.95, defending: 0.96, wetSkill: 0.96 }) },
  { id: 'stroll', name: 'Lance Stroll', abbreviation: 'STR', number: 18, nationality: 'CAN', teamId: 'aston-martin', ratings: rated({ pace: 0.78, wetSkill: 0.85, incidentAvoidance: 0.75 }) },
  { id: 'perez', name: 'Sergio Perez', abbreviation: 'PER', number: 11, nationality: 'MEX', teamId: 'cadillac', ratings: rated({ pace: 0.78, tireManagement: 0.88, defending: 0.86, reliability: 0.82 }) },
  { id: 'bottas', name: 'Valtteri Bottas', abbreviation: 'BOT', number: 77, nationality: 'FIN', teamId: 'cadillac', ratings: rated({ pace: 0.79, qualifying: 0.84, consistency: 0.86, reliability: 0.83 }) },
];
```

- [ ] **Step 5: Add exact configuration validation**

```ts
// src/domain/race-config.ts
import { z } from 'zod';
import type { RaceConfig } from './race-types';

const raceConfigSchema = z.object({
  seed: z.string().min(1),
  laps: z.literal(78),
  presentationMinutes: z.number().min(5).max(8),
  weather: z.enum(['sunny', 'cloudy', 'rain']),
  safetyCars: z.boolean(),
  incidents: z.boolean(),
});

export const DEFAULT_RACE_CONFIG: RaceConfig = {
  seed: 'monaco-2026-opening-race',
  laps: 78,
  presentationMinutes: 6,
  weather: 'sunny',
  safetyCars: true,
  incidents: true,
};

export function parseRaceConfig(input: unknown): RaceConfig {
  return raceConfigSchema.parse(input);
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/domain/grid-2026.test.ts`

Expected: all three tests PASS.

```bash
git add src/domain tests/domain
git commit -m "feat: define validated 2026 race grid"
```

---

### Task 3: Deterministic Randomness, Events, and Classification Types

**Files:**
- Create: `src/simulation/prng.ts`
- Create: `src/simulation/events.ts`
- Create: `src/simulation/selectors.ts`
- Create: `tests/simulation/prng.test.ts`
- Create: `tests/simulation/selectors.test.ts`

**Interfaces:**
- Consumes: `Driver`, `TireCompound`.
- Produces: `createPrng(seed): Prng`, `RaceEvent`, `CarState`, `RaceState`, `getClassification(state): CarState[]`, `getIntervals(state): Map<string, number>`.

- [ ] **Step 1: Write deterministic and classification tests**

```ts
// tests/simulation/prng.test.ts
import { createPrng } from '../../src/simulation/prng';

it('repeats the same sequence for the same seed', () => {
  const a = createPrng('race-42');
  const b = createPrng('race-42');
  expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
});

it('produces different sequences for different seeds', () => {
  expect(createPrng('a').next()).not.toBe(createPrng('b').next());
});
```

```ts
// tests/simulation/selectors.test.ts
import { getClassification } from '../../src/simulation/selectors';
import type { CarState } from '../../src/simulation/events';

it('orders active cars by completed distance and retirees behind finishers', () => {
  const cars = [
    { driverId: 'a', lap: 2, distance: 0.2, status: 'running' },
    { driverId: 'b', lap: 2, distance: 0.8, status: 'running' },
    { driverId: 'c', lap: 4, distance: 0.9, status: 'retired' },
  ] as CarState[];
  expect(getClassification({ cars } as never).map((car) => car.driverId)).toEqual(['b', 'a', 'c']);
});
```

- [ ] **Step 2: Verify failures**

Run: `npm test -- tests/simulation/prng.test.ts tests/simulation/selectors.test.ts`

Expected: FAIL with missing simulation modules.

- [ ] **Step 3: Implement the PRNG contract**

```ts
// src/simulation/prng.ts
export interface Prng {
  next(): number;
  range(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(values: readonly T[]): T;
}

function hash(seed: string): number {
  let value = 2166136261;
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

export function createPrng(seed: string): Prng {
  let state = hash(seed) || 1;
  const next = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    chance: (probability) => next() < probability,
    pick: (values) => values[Math.min(values.length - 1, Math.floor(next() * values.length))],
  };
}
```

- [ ] **Step 4: Define complete race-state and event unions**

Create `CarState` with driver ID, lap, normalized circuit distance, lateral offset, speed, tire compound/wear/temperature, fuel factor, damage, pit state, position, timing, status, and current target line. Create `RaceState` with seed, tick, elapsed simulated seconds, phase, flag, weather, safety-car state, cars, and ordered events.

Define `RaceEvent` as a discriminated union with exact types:

```ts
export type RaceEvent =
  | { type: 'start'; tick: number }
  | { type: 'lap'; tick: number; driverId: string; lap: number; lapTime: number }
  | { type: 'overtake'; tick: number; attackerId: string; defenderId: string; position: number }
  | { type: 'pit-entry' | 'pit-exit'; tick: number; driverId: string }
  | { type: 'tire-change'; tick: number; driverId: string; compound: TireCompound }
  | { type: 'incident'; tick: number; driverIds: string[]; severity: 'minor' | 'major' }
  | { type: 'retirement'; tick: number; driverId: string; reason: string }
  | { type: 'flag'; tick: number; flag: 'green' | 'yellow' | 'safety-car' }
  | { type: 'weather'; tick: number; weather: Weather }
  | { type: 'finish'; tick: number; driverId: string; position: number };
```

- [ ] **Step 5: Implement pure classification and interval selectors**

Sort finishers by finish position, running cars by `lap + distance`, then retirees by retirement tick. Compute leader intervals from authoritative elapsed distance and pace without mutating state.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/simulation/prng.test.ts tests/simulation/selectors.test.ts`

Expected: PASS.

```bash
git add src/simulation tests/simulation
git commit -m "feat: add deterministic simulation primitives"
```

---

### Task 4: Replaceable Spline Track Contract

**Files:**
- Create: `src/track/track-types.ts`
- Create: `src/track/spline-track.ts`
- Create: `src/track/monaco-track.ts`
- Create: `tests/track/spline-track.test.ts`

**Interfaces:**
- Consumes: Three.js `CatmullRomCurve3`, `Vector3`, `Quaternion`.
- Produces: `TrackDefinition`, `TrackTransform`, `createSplineTrack(definition): SplineTrack`, `MONACO_TRACK`.

- [ ] **Step 1: Write track continuity tests**

```ts
// tests/track/spline-track.test.ts
import { createSplineTrack } from '../../src/track/spline-track';
import { MONACO_TRACK } from '../../src/track/monaco-track';

it('closes the racing line continuously', () => {
  const track = createSplineTrack(MONACO_TRACK);
  const start = track.sample(0, 0);
  const end = track.sample(1, 0);
  expect(start.position.distanceTo(end.position)).toBeLessThan(0.01);
});

it('provides grid slots, three sectors, pit path, and camera anchors', () => {
  expect(MONACO_TRACK.gridSlots).toHaveLength(22);
  expect(MONACO_TRACK.sectors).toHaveLength(3);
  expect(MONACO_TRACK.pitLine.length).toBeGreaterThan(3);
  expect(MONACO_TRACK.cameraAnchors.length).toBeGreaterThanOrEqual(8);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/track/spline-track.test.ts`

Expected: FAIL with missing track modules.

- [ ] **Step 3: Define the track contract**

```ts
// src/track/track-types.ts
import type { Vector3, Quaternion } from 'three';

export interface TrackPoint { x: number; y: number; z: number }
export interface TrackZone { start: number; end: number; kind: 'passing' | 'yellow' | 'speed-limit' }
export interface CameraAnchor { id: string; distance: number; position: TrackPoint; targetOffset: TrackPoint }
export interface TrackDefinition {
  id: string;
  lengthMeters: number;
  centerLine: TrackPoint[];
  attackLine: TrackPoint[];
  defendLine: TrackPoint[];
  pitLine: TrackPoint[];
  pitEntry: number;
  pitExit: number;
  sectors: [number, number, number];
  gridSlots: { distance: number; lateral: number }[];
  zones: TrackZone[];
  cameraAnchors: CameraAnchor[];
}
export interface TrackTransform { position: Vector3; rotation: Quaternion; tangent: Vector3 }
export interface SplineTrack { sample(distance: number, lateral: number, line?: 'center' | 'attack' | 'defend' | 'pit'): TrackTransform }
```

- [ ] **Step 4: Implement `createSplineTrack`**

Build closed Catmull-Rom curves for center, attack, and defend lines; build an open pit curve; wrap normalized race distance into `0..1`; derive tangent, lateral normal, and quaternion; apply lateral offset in track-local space.

- [ ] **Step 5: Author the initial Monaco race metadata**

Start from a compact clockwise Monaco outline and resample it into 64 evenly distributed spline controls. Align these controls to the downloaded scenery during the asset task without changing their ordering or the track contract.

```ts
// src/track/monaco-track.ts
import type { TrackDefinition, TrackPoint } from './track-types';

const coarse: TrackPoint[] = [
  { x: 0, y: 0, z: 0 }, { x: 26, y: 1, z: -8 }, { x: 48, y: 5, z: -28 },
  { x: 56, y: 10, z: -56 }, { x: 42, y: 16, z: -82 }, { x: 12, y: 20, z: -92 },
  { x: -16, y: 18, z: -80 }, { x: -28, y: 14, z: -54 }, { x: -22, y: 8, z: -30 },
  { x: -44, y: 3, z: -12 }, { x: -70, y: 0, z: 12 }, { x: -58, y: -2, z: 40 },
  { x: -28, y: -2, z: 52 }, { x: 4, y: -1, z: 46 }, { x: 24, y: 0, z: 28 },
  { x: 14, y: 0, z: 12 },
];

function resampleClosed(points: TrackPoint[], count: number): TrackPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const scaled = (index / count) * points.length;
    const a = points[Math.floor(scaled) % points.length];
    const b = points[(Math.floor(scaled) + 1) % points.length];
    const t = scaled - Math.floor(scaled);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  });
}

const centerLine = resampleClosed(coarse, 64);
const offsetLine = (amount: number) => centerLine.map((point, index) => {
  const next = centerLine[(index + 1) % centerLine.length];
  const dx = next.x - point.x;
  const dz = next.z - point.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: point.x - (dz / length) * amount, y: point.y, z: point.z + (dx / length) * amount };
});

export const MONACO_TRACK: TrackDefinition = {
  id: 'monaco-2026', lengthMeters: 3337,
  centerLine,
  attackLine: offsetLine(-1.4),
  defendLine: offsetLine(1.2),
  pitLine: centerLine.slice(58).concat(centerLine.slice(0, 6)).map((point) => ({ ...point, x: point.x + 4 })),
  pitEntry: 0.91, pitExit: 0.08, sectors: [0.34, 0.66, 1],
  gridSlots: Array.from({ length: 22 }, (_, index) => ({ distance: (1 - index * 0.0045 + 1) % 1, lateral: index % 2 ? 1.2 : -1.2 })),
  zones: [
    { start: 0.0, end: 0.09, kind: 'passing' },
    { start: 0.68, end: 0.78, kind: 'passing' },
    { start: 0, end: 1, kind: 'yellow' },
    { start: 0.91, end: 0.08, kind: 'speed-limit' },
  ],
  cameraAnchors: [0.02, 0.12, 0.24, 0.36, 0.49, 0.63, 0.76, 0.9].map((distance, index) => ({
    id: `camera-${index + 1}`, distance,
    position: { x: centerLine[Math.floor(distance * 64)].x + 12, y: centerLine[Math.floor(distance * 64)].y + 7, z: centerLine[Math.floor(distance * 64)].z + 10 },
    targetOffset: { x: 0, y: 0.5, z: 0 },
  })),
};
```

The free model supplies scenery only; authoritative car motion follows this definition.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/track/spline-track.test.ts`

Expected: PASS.

```bash
git add src/track tests/track
git commit -m "feat: add replaceable Monaco spline track"
```

---

### Task 5: Fixed-Step Race Engine and Pace Model

**Files:**
- Create: `src/simulation/pace.ts`
- Create: `src/simulation/race-engine.ts`
- Create: `tests/simulation/race-engine.test.ts`

**Interfaces:**
- Consumes: `RaceConfig`, `DRIVERS_2026`, `TrackDefinition`, `Prng`, `RaceState`.
- Produces: `RaceEngine`, `createRaceEngine(config, track, drivers): RaceEngine`, `calculateTargetPace(input): number`.

- [ ] **Step 1: Write fixed-step and full-race tests**

```ts
// tests/simulation/race-engine.test.ts
import { createRaceEngine } from '../../src/simulation/race-engine';
import { DEFAULT_RACE_CONFIG } from '../../src/domain/race-config';
import { DRIVERS_2026 } from '../../src/domain/grid-2026';
import { MONACO_TRACK } from '../../src/track/monaco-track';

it('produces identical state for identical seeds and elapsed time', () => {
  const a = createRaceEngine(DEFAULT_RACE_CONFIG, MONACO_TRACK, DRIVERS_2026);
  const b = createRaceEngine(DEFAULT_RACE_CONFIG, MONACO_TRACK, DRIVERS_2026);
  a.advance(20);
  b.advance(20);
  expect(a.snapshot()).toEqual(b.snapshot());
});

it('finishes 22 classified cars after an accelerated race', () => {
  const engine = createRaceEngine(DEFAULT_RACE_CONFIG, MONACO_TRACK, DRIVERS_2026);
  engine.runToFinish();
  expect(engine.snapshot().phase).toBe('finished');
  expect(engine.snapshot().cars).toHaveLength(22);
  expect(engine.snapshot().cars.filter((car) => car.status === 'finished' || car.status === 'retired')).toHaveLength(22);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/simulation/race-engine.test.ts`

Expected: FAIL with missing race engine.

- [ ] **Step 3: Implement the pace function**

```ts
// src/simulation/pace.ts
export interface PaceInput {
  basePace: number;
  consistencyNoise: number;
  tireGrip: number;
  fuelFactor: number;
  trafficFactor: number;
  slipstreamFactor: number;
  damageFactor: number;
  flagFactor: number;
}

export function calculateTargetPace(input: PaceInput): number {
  return Math.max(0.15,
    input.basePace * input.tireGrip * input.fuelFactor * input.trafficFactor *
    input.slipstreamFactor * input.damageFactor * input.flagFactor *
    (1 + input.consistencyNoise));
}
```

- [ ] **Step 4: Implement the fixed-step engine**

Use a 10 Hz authoritative tick. `advance(realSeconds)` converts presentation time using `78 laps / presentationMinutes`; it accumulates fractional time and executes complete fixed steps. `runToFinish()` advances fixed ticks with a maximum safety bound of two million ticks. Clone snapshots before returning them.

The public interface must be:

```ts
export interface RaceEngine {
  advance(presentationSeconds: number): void;
  snapshot(): Readonly<RaceState>;
  drainEvents(): RaceEvent[];
  runToFinish(): void;
}
```

- [ ] **Step 5: Add start, lap, sector, finish, and authoritative position updates**

Initialize the grid from track slots. Advance running cars by target pace, wrap distance at the timing line, increment laps, emit lap events, finish after lap 78, and derive classification after each tick.

- [ ] **Step 6: Verify determinism and commit**

Run: `npm test -- tests/simulation/race-engine.test.ts`

Expected: PASS and full headless race finishes in under five seconds on the development machine.

```bash
git add src/simulation tests/simulation/race-engine.test.ts
git commit -m "feat: implement deterministic fixed-step race engine"
```

---

### Task 6: Tires, Pit Strategy, Overtakes, Incidents, and Safety Car

**Files:**
- Create: `src/simulation/tires.ts`
- Create: `src/simulation/strategy.ts`
- Create: `src/simulation/overtakes.ts`
- Create: `src/simulation/incidents.ts`
- Modify: `src/simulation/race-engine.ts`
- Create: `tests/simulation/race-rules.test.ts`

**Interfaces:**
- Consumes: `CarState`, `Driver`, `Prng`, `RaceEvent`, `TrackZone`.
- Produces: `updateTire`, `createStrategy`, `evaluateOvertake`, `evaluateIncident`, safety-car transitions integrated into `RaceEngine`.

- [ ] **Step 1: Write complete rule tests**

```ts
// tests/simulation/race-rules.test.ts
import { updateTire } from '../../src/simulation/tires';
import { createPrng } from '../../src/simulation/prng';
import { evaluateOvertake } from '../../src/simulation/overtakes';

it('reduces grip as a tire exceeds its useful life', () => {
  const fresh = updateTire({ compound: 'soft', wear: 0.1, temperature: 0.8 }, 1, 0.8);
  const worn = updateTire({ compound: 'soft', wear: 0.85, temperature: 0.8 }, 1, 0.8);
  expect(worn.grip).toBeLessThan(fresh.grip);
});

it('replays the same overtake decision from the same seed', () => {
  const input = { paceAdvantage: 0.08, gapSeconds: 0.4, passingZone: true, attackerSkill: 0.9, defenderSkill: 0.7 };
  expect(evaluateOvertake(input, createPrng('pass'))).toEqual(evaluateOvertake(input, createPrng('pass')));
});
```

Add engine tests asserting a pit stop changes compound and costs time, a retiree never finishes, and safety car state emits `flag` events and compresses active-car gaps.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/simulation/race-rules.test.ts`

Expected: FAIL with missing race-rule modules.

- [ ] **Step 3: Implement tire curves and strategy plans**

Use compound-specific warmup, useful-life, and cliff parameters. `updateTire` returns wear, temperature, and grip without mutation. `createStrategy` returns one- or two-stop windows and compounds using the seeded PRNG; adapt within bounded windows for safety cars and severe traffic.

- [ ] **Step 4: Implement overtake state transitions**

Return `'none' | 'attack' | 'pass' | 'failed' | 'contact'`. Require a passing zone, bounded gap, and pace advantage for attempts. Move attacker and defender onto alternate lines during attacks, and commit position changes only at ordering checkpoints.

- [ ] **Step 5: Implement incidents and safety-car state**

Evaluate lockup, spin, contact, and mechanical failure probabilities from proximity, relative speed, weather, driver ratings, damage, and reliability. Minor incidents apply time/damage penalties. Major incidents may retire cars and trigger yellow or safety car. Safety car controls pace, disables overtakes, bunches the field gradually, then returns through yellow to green.

- [ ] **Step 6: Add a 200-seed invariant test**

Run 200 headless races and assert: no duplicate finish positions, no negative lap time, no retiree later finishes, every race terminates, and at least two distinct winners occur.

- [ ] **Step 7: Verify and commit**

Run: `npm test -- tests/simulation`

Expected: all simulation tests PASS.

```bash
git add src/simulation tests/simulation
git commit -m "feat: add race strategy battles and incidents"
```

---

### Task 7: Race Store and Playback Integration

**Files:**
- Create: `src/store/race-store.ts`
- Create: `tests/store/race-store.test.ts`

**Interfaces:**
- Consumes: `createRaceEngine`, `RaceState`, `RaceEvent`, `DEFAULT_RACE_CONFIG`.
- Produces: `useRaceStore`, `raceStore`, actions `tick`, `togglePause`, `setSpeed`, `selectDriver`, `setCameraMode`, `restart`, `replaySeed`.

- [ ] **Step 1: Write store tests**

```ts
// tests/store/race-store.test.ts
import { raceStore } from '../../src/store/race-store';

it('pauses, changes speed, and replays a seed', () => {
  const initial = raceStore.getState().snapshot;
  raceStore.getState().setSpeed(4);
  raceStore.getState().tick(1);
  expect(raceStore.getState().snapshot.tick).toBeGreaterThan(initial.tick);
  raceStore.getState().togglePause();
  const pausedTick = raceStore.getState().snapshot.tick;
  raceStore.getState().tick(1);
  expect(raceStore.getState().snapshot.tick).toBe(pausedTick);
  raceStore.getState().replaySeed();
  expect(raceStore.getState().snapshot.seed).toBe(initial.seed);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/store/race-store.test.ts`

Expected: FAIL with missing store.

- [ ] **Step 3: Implement the vanilla Zustand store and React hook**

Keep the mutable `RaceEngine` outside serializable UI state. On `tick(delta)`, advance by `delta * speed`, drain events, cap feed history at 100 entries, and publish the latest immutable snapshot. Accept only speeds `1 | 2 | 4 | 8` and camera modes `'broadcast' | 'chase' | 'cockpit' | 'overhead' | 'free'`.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- tests/store/race-store.test.ts`

Expected: PASS.

```bash
git add src/store tests/store
git commit -m "feat: integrate playback state with race engine"
```

---

### Task 8: Free Asset Pipeline and License Verification

**Files:**
- Create: `src/assets/asset-registry.ts`
- Create: `src/assets/credits.json`
- Create: `scripts/verify-assets.mjs`
- Create: `public/assets/models/monaco-track.glb`
- Create: `public/assets/models/f1-car.glb`
- Create: `public/assets/textures/teams/*.webp`
- Create: `public/assets/audio/README.md`

**Interfaces:**
- Consumes: free source archives and their bundled license files.
- Produces: `ASSETS`, optimized GLB files, 11 original team texture variants, verified `credits.json`.

- [ ] **Step 1: Create the asset registry and manifest schema**

```ts
// src/assets/asset-registry.ts
export const ASSETS = {
  track: '/assets/models/monaco-track.glb',
  car: '/assets/models/f1-car.glb',
  teamTexture: (teamId: string) => `/assets/textures/teams/${teamId}.webp`,
} as const;
```

Each credit entry must contain `id`, `title`, `creator`, `source`, `license`, `licenseUrl`, `downloadedAt`, `originalFile`, `runtimeFile`, and `modifications`.

- [ ] **Step 2: Write the failing manifest verifier**

`scripts/verify-assets.mjs` must read `credits.json`, reject duplicate IDs, reject missing source/license/runtime file fields, and verify every runtime file exists under `public/`. It exits nonzero with one line per problem.

Run: `npm run verify:assets`

Expected: FAIL because runtime asset files are absent.

- [ ] **Step 3: Acquire and record the free Monaco track**

Download the free CC BY model from `https://sketchfab.com/3d-models/monaco-gp-racetrack-ebb9b9a0c19e4801815b19c55d14dea3` using the site's authorized download flow. Preserve the archive and license in `work/assets-source/`. If that download is unavailable, choose a different free F1 circuit whose archive explicitly permits modification and web use, then update the asset manifest and `MONACO_TRACK` display name without changing engine interfaces.

- [ ] **Step 4: Acquire and record the free open-wheel car**

Download the CC0 Blender source from `https://opengameart.org/content/low-poly-formula-1-car`. Preserve its source and license in `work/assets-source/`.

- [ ] **Step 5: Optimize the models**

In Blender or an equivalent license-compatible conversion tool: normalize scale and axes, join unnecessary material slots, remove unused objects, preserve separate wheels when present, bake or simplify materials, export GLB, and run glTF compression. Keep the track below 30 MB and the shared car below 2 MB. Confirm both load without console errors.

- [ ] **Step 6: Create original team textures**

Create 11 small WebP livery textures using the official 2026 team colors, driver numbers, and locally drawn patterns. Do not extract textures from commercial models. Keep every texture at or below 1024x1024 and 300 KB.

- [ ] **Step 7: Verify assets and commit**

Run: `npm run verify:assets`

Expected: PASS with 13 required runtime entries: one track, one car, and 11 team textures.

```bash
git add src/assets public/assets scripts/verify-assets.mjs
git commit -m "feat: add verified free race assets"
```

---

### Task 9: Three.js Environment and 22-Car Presentation

**Files:**
- Create: `src/scene/RaceScene.tsx`
- Create: `src/scene/Environment.tsx`
- Create: `src/scene/CarField.tsx`
- Create: `src/scene/RaceEffects.tsx`
- Modify: `src/app/App.tsx`
- Create: `tests/ui/race-scene.test.tsx`

**Interfaces:**
- Consumes: `ASSETS`, `useRaceStore`, `createSplineTrack(MONACO_TRACK)`.
- Produces: `RaceScene`, clickable cars with `data-driver-id`, responsive quality tiers, asset fallbacks.

- [ ] **Step 1: Write the scene shell test**

```tsx
// tests/ui/race-scene.test.tsx
import { render, screen } from '@testing-library/react';
import { App } from '../../src/app/App';

it('exposes an accessible race viewport and loading status', () => {
  render(<App />);
  expect(screen.getByRole('region', { name: '3D race viewport' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent(/preparing|loading|ready/i);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/ui/race-scene.test.tsx`

Expected: FAIL because the canvas shell is missing.

- [ ] **Step 3: Implement the canvas and quality tier**

Render an R3F `Canvas` inside `section[aria-label="3D race viewport"]`. Use a capped DPR of `[1, 1.5]` on desktop and `1` on mobile. Choose `high` or `mobile` quality once from viewport and coarse-pointer signals, with a user override.

- [ ] **Step 4: Implement environment loading with fallbacks**

Load the track GLB inside `Suspense`. If loading fails, render the authoritative racing spline as a low-poly ribbon with barriers so the simulation remains viewable. Add directional sun, hemisphere fill, atmospheric fog, simplified harbor plane, and low-cost reflections.

- [ ] **Step 5: Implement car presentation**

Load one car geometry, clone materials per team, and render 22 cars from snapshot state. Sample track transforms, interpolate between snapshots, rotate wheels from distance, steer from tangent change, offset pit cars to the pit spline, hide retired cars only after their incident presentation completes, and call `selectDriver(driverId)` on click.

- [ ] **Step 6: Implement pooled visual effects**

Create fixed-size pools for 32 smoke puffs, 64 sparks, and 24 debris pieces. Trigger them from incident events; disable speed streaks, strong shake, and motion blur when reduced motion is active.

- [ ] **Step 7: Verify and commit**

Run: `npm test -- tests/ui/race-scene.test.tsx`

Run: `npm run build`

Expected: tests and build PASS.

```bash
git add src/scene src/app tests/ui/race-scene.test.tsx
git commit -m "feat: render Monaco race and 22-car field"
```

---

### Task 10: Camera Director and Manual Cameras

**Files:**
- Create: `src/cameras/camera-director.ts`
- Create: `src/cameras/RaceCameras.tsx`
- Create: `tests/simulation/camera-director.test.ts`

**Interfaces:**
- Consumes: race events, selected driver, `TrackDefinition.cameraAnchors`, camera mode.
- Produces: `selectBroadcastShot(input): BroadcastShot`, R3F camera controller for all five approved modes.

- [ ] **Step 1: Write shot-priority and cooldown tests**

```ts
// tests/simulation/camera-director.test.ts
import { selectBroadcastShot } from '../../src/cameras/camera-director';

it('prioritizes a major incident over a routine lap event', () => {
  const shot = selectBroadcastShot({
    now: 20,
    lastCutAt: 10,
    events: [
      { type: 'lap', tick: 200, driverId: 'norris', lap: 2, lapTime: 72 },
      { type: 'incident', tick: 201, driverIds: ['leclerc', 'hamilton'], severity: 'major' },
    ],
  });
  expect(shot.reason).toBe('incident');
});

it('holds the current shot during the minimum duration', () => {
  expect(selectBroadcastShot({ now: 11, lastCutAt: 10, events: [] }).action).toBe('hold');
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/simulation/camera-director.test.ts`

Expected: FAIL with missing director.

- [ ] **Step 3: Implement broadcast ranking**

Rank start, finish, major incidents, overtakes, pit battles, close gaps, fastest laps, and routine running. Enforce a three-second minimum and ten-second normal maximum shot duration; allow major incidents and the finish to interrupt after one second.

- [ ] **Step 4: Implement five camera modes**

Broadcast uses track anchors and smooth look-at targets. Chase and cockpit follow the selected car with damped transforms. Overhead frames the complete spline. Free uses Drei orbit controls. Manual modes suppress automatic incident cuts until broadcast mode resumes.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- tests/simulation/camera-director.test.ts`

Run: `npm run build`

Expected: PASS.

```bash
git add src/cameras tests/simulation/camera-director.test.ts
git commit -m "feat: add cinematic race cameras"
```

---

### Task 11: Timing HUD, Controls, Finish Screen, and Credits

**Files:**
- Create: `src/ui/RaceHud.tsx`
- Create: `src/ui/Leaderboard.tsx`
- Create: `src/ui/DriverPanel.tsx`
- Create: `src/ui/TrackMap.tsx`
- Create: `src/ui/EventFeed.tsx`
- Create: `src/ui/PlaybackControls.tsx`
- Create: `src/ui/FinishScreen.tsx`
- Create: `src/ui/CreditsPanel.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/styles.css`
- Create: `tests/ui/race-hud.test.tsx`

**Interfaces:**
- Consumes: `useRaceStore`, classification selectors, `MONACO_TRACK`, `credits.json`.
- Produces: responsive, keyboard-operable spectator interface and final classification.

- [ ] **Step 1: Write interaction and accessibility tests**

```tsx
// tests/ui/race-hud.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RaceHud } from '../../src/ui/RaceHud';

it('selects a driver and changes playback speed', async () => {
  render(<RaceHud />);
  await userEvent.click(screen.getByRole('button', { name: /follow kimi antonelli/i }));
  expect(screen.getByRole('heading', { name: /kimi antonelli/i })).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText('Simulation speed'), '4');
  expect(screen.getByLabelText('Simulation speed')).toHaveValue('4');
});

it('provides text labels for tire, flag, and retirement status', () => {
  render(<RaceHud />);
  expect(screen.getByLabelText(/race flag/i)).toBeVisible();
  expect(screen.getAllByText(/soft|medium|hard/i).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/ui/race-hud.test.tsx`

Expected: FAIL with missing HUD modules.

- [ ] **Step 3: Implement the leaderboard, top bar, driver panel, and event feed**

Use semantic buttons for driver rows, live but throttled event announcements, explicit tire text plus color, and `aria-current` for the selected driver. Show position, abbreviation, interval, last lap, fastest lap, tire, pit, warning, and DNF state.

- [ ] **Step 4: Implement playback and camera controls**

Use a native labeled select for speed and buttons for pause, restart, new seed, replay seed, camera modes, labels, effects, audio, reduced motion, and quality. Require confirmation only for restarting an active race when more than one lap has elapsed.

- [ ] **Step 5: Implement the SVG track map**

Project centerline X/Z points into a normalized SVG viewBox. Render 22 markers keyed by driver ID, with team color, selected outline, and text alternatives in a visually hidden ordered list.

- [ ] **Step 6: Implement finish and credits panels**

Finish screen lists classification, winner time, intervals, fastest lap, pit count, retirement reason, incident recap, and seed. Credits panel renders every manifest entry with creator, source link, license, and modifications, plus the generated-timing disclosure.

- [ ] **Step 7: Implement responsive styling**

Desktop uses a left timing tower, top bar, selected-driver card, lower controls, and event feed. At widths below 760 px, use a collapsible timing drawer and bottom control strip. Maintain 44 px touch targets, readable contrast, visible focus, and scalable text.

- [ ] **Step 8: Verify and commit**

Run: `npm test -- tests/ui`

Run: `npm run build`

Expected: PASS.

```bash
git add src/ui src/app tests/ui
git commit -m "feat: add responsive race broadcast interface"
```

---

### Task 12: Synthesized Audio and Accessibility Preferences

**Files:**
- Create: `src/audio/race-audio.ts`
- Modify: `src/store/race-store.ts`
- Modify: `src/ui/PlaybackControls.tsx`
- Modify: `src/scene/RaceEffects.tsx`
- Create: `tests/simulation/race-audio.test.ts`

**Interfaces:**
- Consumes: race snapshots, race events, selected driver, mute and reduced-motion settings.
- Produces: `RaceAudioController` with `resume`, `update`, `handleEvents`, `setMuted`, `dispose`.

- [ ] **Step 1: Write lifecycle tests using an injected audio factory**

Assert the controller creates no audio context before `resume()`, changes oscillator gain/pitch from selected-car speed, does not emit incident sounds when muted, and disconnects all nodes on `dispose()`.

- [ ] **Step 2: Verify failure**

Run: `npm test -- tests/simulation/race-audio.test.ts`

Expected: FAIL with missing audio controller.

- [ ] **Step 3: Implement synthesized audio**

Create a layered engine tone from two oscillators, filtered noise for tire scrub and crowd, and short envelopes for pit and impact events. Start only after an explicit user interaction. Clamp gain to a conservative maximum and smoothly ramp frequency/gain.

- [ ] **Step 4: Persist user preferences**

Store mute, reduced motion, label visibility, quality, and camera mode in local storage through a versioned preferences object. Respect `prefers-reduced-motion` until the user explicitly overrides it.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- tests/simulation/race-audio.test.ts tests/ui`

Expected: PASS.

```bash
git add src/audio src/store src/ui src/scene tests/simulation/race-audio.test.ts
git commit -m "feat: add race audio and accessibility preferences"
```

---

### Task 13: Browser Verification, Performance, and Delivery Readiness

**Files:**
- Create: `tests/e2e/race.spec.ts`
- Create: `playwright.config.ts`
- Create: `README.md`
- Modify: `src/assets/credits.json` if verification exposes omissions.

**Interfaces:**
- Consumes: complete application.
- Produces: automated smoke coverage, documented local operation, measured desktop/mobile readiness.

- [ ] **Step 1: Add Playwright web-server configuration**

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['iPhone 14'] } },
  ],
});
```

- [ ] **Step 2: Write the end-to-end race test**

```ts
// tests/e2e/race.spec.ts
import { test, expect } from '@playwright/test';

test('starts, follows a driver, changes camera, and restarts with a seed', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Monaco 2026 Simulation' })).toBeVisible();
  await page.getByRole('button', { name: /follow kimi antonelli/i }).click();
  await page.getByRole('button', { name: 'Chase camera' }).click();
  await page.getByLabel('Simulation speed').selectOption('8');
  await expect(page.getByLabel('Current lap')).not.toHaveText('0');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Replay this seed' }).click();
  await expect(page.getByLabel('Current lap')).toHaveText('1');
});
```

- [ ] **Step 3: Run all automated verification**

Run:

```bash
npm test
npm run verify:assets
npm run build
npx playwright install chromium
npm run test:e2e
```

Expected: every command exits zero; desktop and mobile projects PASS.

- [ ] **Step 4: Run deterministic soak verification**

Execute the 200-seed headless test with timing output. Expected: zero invariant failures and completion within the test timeout.

- [ ] **Step 5: Inspect performance-critical scenarios**

Measure race start, pit-lane congestion, safety-car bunching, and multi-car incident scenes at desktop and mobile viewports. Desktop target is 60 FPS at 1440x900; mobile target is 30 FPS near 390x844. If a target is missed, reduce crowd instances, shadow casters, reflection resolution, post-processing, particle pool visibility, and distant scenery in that order without changing simulation behavior.

- [ ] **Step 6: Verify resource cleanup**

Run five race restarts and confirm WebGL renderer memory, active event listeners, audio nodes, and pooled effect counts return to their steady-state ranges after every restart.

- [ ] **Step 7: Write user-facing project documentation**

Document prerequisites, install/run/build/test commands, controls, camera modes, simulation disclosure, seed replay, asset credits, mobile quality behavior, and the future player-controller extension boundary in `README.md`.

- [ ] **Step 8: Final verification and commit**

Run: `npm test && npm run verify:assets && npm run build && npm run test:e2e`

Expected: all checks PASS.

```bash
git add tests/e2e playwright.config.ts README.md src/assets/credits.json
git commit -m "test: verify F1 simulation delivery"
```
