# Plan — fix the motion, then build the game

Two pieces of work. The first is a prerequisite for the second: there is no point
letting someone race cars that look wrong when they move.

---

# Part 1 — why the motion looks wrong, and how to fix it

The problems are not vague. Reading the code gives three specific causes.

## Diagnosis

### 1. Everything runs at ~12× real speed

`race-engine.ts` compresses the whole race into the presentation window:

```
56 laps × 76.2 s reference lap = 4267 s of racing
compressed into 6 minutes      =  360 s of screen time
                                 ------
                                 ~11.9× real time
```

So at "1×" the cars are doing roughly **twelve times** real speed. A car at
300 km/h is covering ~1000 m/s on screen. Nothing about that can look realistic —
the wheels, the steering, the closing rate, all of it is running at 12×.

**This is the single biggest cause of the "spinning extremely fast" look.**

### 2. Wheel rotation accumulates into a huge number

```ts
const wheelRotation = ((car.lap + car.distance) * SHANGHAI_TRACK.lengthMeters) / 0.43;
```

This is total distance travelled divided by wheel radius, never wrapped. By the
end of a race it reaches **~695,000 radians**. Feeding a number that large into a
rotation loses angular precision, which shows up as wheel jitter and strobing.
It is also driven by distance rather than by speed, so it cannot respond to
braking or acceleration.

### 3. All fourteen cars re-render on every frame

```ts
const cars = useRaceStore((state) => state.snapshot.cars);
const tick = useRaceStore((state) => state.snapshot.tick);
```

`CarField` subscribes to state that changes every frame, so React reconciles
fourteen car components — each rebuilding a canvas texture, re-running effects —
sixty times a second. That is the lag. The smoothing lerp then chases a target
that is already late, which reads as jitter rather than motion.

### 4. Spacing

Gaps are real (0.18 s ≈ 12 m), but two things make cars look glued together:
the sim's pace model is tight enough that the field bunches, and there is no
minimum following distance, so cars can visually occupy the same space. Real
cars cannot overlap; ours can.

## The fixes

### 1.1 Decouple presentation speed from race length — *the big one*

Stop compressing a full 56-lap race into six minutes. Instead:

- **A "race" is a short race.** For the game, 5–10 laps, run at **1×–3× real
  speed**, not 12×. The racing looks right because it *is* roughly right.
- Keep the full 56-lap championship distance as a separate "full distance"
  option for people who want it, clearly labelled as time-compressed.
- Playback speeds then mean what they say: 1× is real time.

This is a config and framing change, not an engine rewrite. The engine is
already deterministic and tick-based; we are changing how much race we ask it to
fit into how much screen time.

### 1.2 Fixed-timestep simulation, interpolated rendering

The standard game-loop separation:

- Engine steps at a **fixed rate** (say 30 Hz of simulated time).
- The renderer keeps the **previous and current** car states and interpolates
  between them by the leftover fraction each frame.

This gives smooth motion at any frame rate and removes the "chasing a late
target" lag entirely. It also makes motion independent of display refresh rate.

### 1.3 Drive transforms imperatively, not through React

Read the snapshot inside a **single** `useFrame` and mutate the car objects'
positions and quaternions directly. React renders the fourteen cars **once**;
after that, per-frame updates never touch the reconciler.

Expected effect: the largest single win for both jitter and battery.

### 1.4 Realistic wheel and steering behaviour

- Wrap rotation: `wheelRotation % (2π)`.
- Derive it from **current speed**, not accumulated distance, so wheels visibly
  slow under braking and spin up on exit.
- Add subtle body motion that sells weight: brake dive, acceleration squat, roll
  into corners. These are cheap and do more for realism than extra polygons.
- Steering angle from the upcoming curvature, damped — front wheels should lead
  the car into a corner.

### 1.5 Real spacing

- Enforce a **minimum following distance** in the sim so cars cannot overlap.
- Widen the pace spread so the field strings out naturally instead of bunching.
- Lateral offsets should place a following car **off the racing line**, not
  directly behind — which is both more realistic and reads better on camera.

### 1.6 Verification

- A test asserting no two cars are ever closer than one car length.
- A test asserting wheel rotation stays bounded.
- Frame-time budget already exists in the E2E suite; extend it to assert a
  minimum sustained FPS with all fourteen cars visible.

**Order:** 1.3 (render path) → 1.2 (interpolation) → 1.1 (speed) → 1.4/1.5
(feel). The first two remove jitter; the third makes it look real; the fourth
makes it look *good*.

---

# Part 2 — the game

Turn the simulation from something you watch into something you play.

## The loop

1. **Choose your driver and car** — the garage becomes a picker.
2. **Grid up** — see where you start.
3. **Race** — you control your car; thirteen AI cars race you.
4. **Result** — position, best lap, what you did well, what cost you.
5. **Again** — a better result is one click away.

## What "control" means

An honest recommendation: **do not build a full driving sim.** Keyboard-driven
6-DOF F1 physics is months of work and would be worse than the many games that
already do it.

Instead, control the things F1 is actually *about* — the decisions:

- **Throttle/brake and racing line** — hold to push, ease to save the tyre.
  Push too long and the tyre goes off; that is the whole sport in one control.
- **Overtake / defend** — commit to a move when close enough, with real risk.
- **DRS** — usable only when the rules allow, so the rule teaches itself.
- **Pit when you choose** — the strategy call is yours.

This keeps the existing deterministic engine as the authority, adds a player
whose inputs feed the same model, and teaches the sport by making you live its
trade-offs. It is achievable, and it is *differentiated* — nobody else turns
tyre management into the core verb.

A full arcade-drive mode can come later if the appetite is there.

## UI to build

| Screen | Purpose |
| --- | --- |
| Car select | Pick team and driver; show handling traits |
| Pre-race | Grid slot, tyre choice, lap count, difficulty |
| Race HUD | Speed, gear, tyre life, position, gap ahead/behind, DRS state, lap counter |
| Race result | Classification, your best lap, key moments explained |
| Progression | Best results per circuit, career-ish sense of improvement (localStorage) |

Explain Mode stays on throughout — after a race it becomes the debrief: *"you
lost two places on lap 8 because your tyres were 40% more worn than Norris's."*

## Audio

There is already a procedural Web Audio engine (`race-audio.ts`) — oscillators
and filtered noise, no samples. For a game we need more:

**Effects (procedural where possible)**
- Engine note driven by **RPM and load**, not a loop — the existing synth can be
  extended to do this well and it stays tiny.
- Tyre scrub rising with slip angle, lock-up screech under heavy braking.
- DRS actuation, gear shifts, kerb rumble, pit-lane limiter.
- Doppler and distance attenuation for cars passing the camera — cheap, and it
  is most of what makes racing audio feel real.

**Music**
- A menu bed and a race bed that responds to intensity.

**A caution worth stating up front:** music and any sampled audio must be
properly licensed. We cannot use F1 broadcast audio or copyrighted tracks. The
options are commissioned/licensed music, a CC0 or royalty-free library with the
licence recorded in `credits.json` like every other asset, or fully procedural
generation. Given our asset provenance is *already* an open issue, we should not
add another unlicensed dependency — decide the source before building the
soundtrack in.

## Phasing

| Phase | Scope |
| --- | --- |
| **G0** | Part 1 in full. Non-negotiable prerequisite. |
| **G1** | Car select → grid → race → result, with the player as a normal AI car. Proves the loop and all the UI without any input handling. |
| **G2** | Player input: throttle/brake, tyre management, overtake commit. |
| **G3** | Audio: procedural engine/tyre/DRS, doppler, then licensed music. |
| **G4** | Difficulty, progression, per-circuit bests. |

G1 is deliberately playable-without-controls so the whole flow can be reviewed
before input design is locked in.

---

## Risks

- **A 12× race is currently load-bearing** for the "watch a full Grand Prix in
  six minutes" pitch. Shortening races for the game is right, but the watch
  experience should keep a compressed option rather than losing that framing.
- **Determinism must survive player input.** The seed guarantees a reproducible
  world; the player is the one non-deterministic element. Record inputs so a
  race can still be replayed and explained.
- **Licensing, again.** Cars, drivers, circuit and now audio. The pile is
  growing, and a game people share has a very different exposure profile from a
  private prototype.
