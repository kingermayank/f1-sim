# APEX — implementation plan

Decisions locked with the project owner on 2026-08-05:

| Decision | Choice |
| --- | --- |
| Name | **APEX** (placeholder, kept) |
| Identities | **Real** 2026 driver and team names |
| Persistence | **localStorage only** — no accounts, no backend |
| First feature | **Explain Mode** |
| Also in scope | Quiz with scoring, Predict the Podium, Find My Driver, corner-by-corner annotations |
| Typography | Formula1 Wide **only for large headings**; never for body or dense UI |

The racing simulation is finished and must not change. Everything here wraps it.

---

## 0. Typography correction (do first)

Formula1 Wide is a display face. At body sizes and in dense panels it is genuinely
hard to read, and the concept prototype over-used it on every heading level.

**Rule, applied everywhere:**

- `--font-wide` (Formula1 Wide) — hero titles and section headings **≥ 1.5rem only**.
  Never below that size, never for more than a few words, never for paragraphs.
- `--font-display` (Formula1 Display) — all other headings, labels, buttons, body.
- `--font-mono` (MonoSpec) — numerals, timing, gaps, any figure that ticks.

Minimum body size 0.8rem. Letter-spacing stays near zero on Display; Wide can
carry tracking because it is only ever a few large words.

---

## 1. Architecture

Frontend-only, no new runtime dependencies.

```
src/
  shell/          NEW  browse experience
    Router.tsx         hash router: #/ #/circuits #/circuits/:id #/garage #/drivers #/learn #/race
    AppNav.tsx         persistent top nav + button legend
    HomeView.tsx       mosaic dashboard
    CircuitsView.tsx   circuit grid (Shanghai live, rest honest placeholders)
    CircuitView.tsx    circuit detail + corner annotations
    GarageView.tsx     seven team cars
    DriversView.tsx    fourteen drivers
    LearnView.tsx      quiz + glossary
  explain/        NEW  Explain Mode
    explain.ts         pure: RaceEvent + RaceState -> plain-English reason
    glossary.ts        term -> definition, used by tooltips
    ExplainPanel.tsx   annotated feed beside the race
    Jargon.tsx         dashed-underline tooltip primitive
  content/        NEW  editorial data, no logic
    circuits.ts        circuit metadata + corner notes
    driver-profiles.ts personality hooks + trait vectors for Find My Driver
    quiz.ts            question bank
  progress/       NEW  localStorage
    progress-store.ts  quiz scores, predictions, matched driver, streak
```

Existing `src/scene`, `src/simulation`, `src/cameras`, `src/track`, `src/domain`
are **not modified**. `src/app/App.tsx` becomes a router host; the current race
view moves behind the `#/race` route unchanged.

### Routing

Hash routing, ~40 lines, no dependency. It keeps the app a static build, works
from `file://` and any static host, and needs no server rewrite rules.

---

## 2. Phases

### P0 — Shell

Landing, circuits, circuit detail, garage, drivers, and routing into the race.
All data already in the repo (7 teams, 14 drivers, Shanghai track definition).
Unbuilt circuits render as labelled placeholders — never faked.

**Done when:** every route renders, the race still runs unchanged at `#/race`,
and the full existing gate stays green.

### P1 — Explain Mode ← the reason this product exists

`explain.ts` is a pure function: given a `RaceEvent` plus the `RaceState` around
it, return a plain-English reason. Pure means unit-testable with no renderer.

Coverage, mapped to the confusions the research identified:

| Event | Explanation surfaces |
| --- | --- |
| `tire-change` | compound change, why that compound, undercut vs overcut |
| `pit-entry` | tyre degradation cost vs ~24 s pit loss |
| `overtake` | DRS, tyre delta, or track position |
| `flag` | what yellow / safety car means for the driver |
| `incident` / `retirement` | consequence in plain terms |
| `lap` / `sector` | pace deltas, when notable |

Every jargon term wraps in `<Jargon>` → dashed underline → tooltip from
`glossary.ts`. Explain Mode is a toggle, persisted; the strategy nerd turns it off.

**Done when:** every event type produces a sensible reason, all jargon is
tooltipped, and `explain.ts` has unit tests covering each event type.

### P2 — Engagement (localStorage)

- **Quiz** — banked questions, scored, best score persisted. Questions drawn
  from the same glossary so learning and testing share one source of truth.
- **Predict the Podium** — pick top three before a seed runs, scored after,
  streak persisted.
- **Find My Driver** — six questions, cosine match against driver trait vectors
  derived from the ratings the simulation already uses.
- **Corner annotations** — tap a corner on the circuit map for why it is hard.

### P3 — Later

Second circuit, share cards, what-if re-run. Not now.

---

## 3. Verification

Every phase keeps the existing gate green: `npm test`, `npm run verify:assets`,
`npm run build`, `npm run test:e2e`.

New tests:

- `explain.ts` — one case per event type, asserting the reason mentions the
  causal factor rather than restating the event.
- `progress-store.ts` — persistence round-trip, and corrupt-storage tolerance.
- Router — each route renders its view; unknown hash falls back to home.
- Shell views — placeholders are labelled as unavailable, and the driver and
  team counts match the grid definition rather than being hardcoded.

---

## 4. Risks

**The simulation must produce races worth explaining.** Everything above assumes
the generated races are dramatic enough to be worth annotating. Confirm by
watching several seeds before investing in P2.

**Real identities are unlicensed.** Driver and team names, liveries and
likenesses remain recorded as `UNVERIFIED` in `src/assets/credits.json`. Fine for
a private prototype; must be resolved before any public release, and the cost of
changing course grows once identity features are built on top.
