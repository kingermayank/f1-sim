# APEX — a process case study

*How a Sketchfab download became a race you can watch, understand, and soon control.*

This is the honest version. It includes the parts that went wrong, because those
are where most of the decisions actually got made.

---

## 1. Where it started

The starting point was a working prototype: a deterministic race simulation
running on a stylised, invented Monaco — a track authored by hand as sixteen
coordinates, cars that were coloured boxes, and a coordinate system where one
unit meant roughly eight metres because nobody had needed it to mean anything.

The brief was to replace all of that with the real thing: a licensed 3D model of
the Shanghai International Circuit and seven real team cars, downloaded from
Sketchfab. And the handoff was explicit about the trap to avoid — *do not just
swap the visible mesh and leave the old racing line underneath*. The spline, the
pit lane, the grid, the sectors and the lap count all had to become Shanghai.

Three decisions were taken up front, before any files moved:

- **The folder got a real name** (`f1-simulation`, hyphenated, because a space
  in a repo path is friction for every tool that touches it).
- **The grid shrank to seven teams.** Only seven cars had models. The
  alternative — a neutral car re-liveried for the missing four — was rejected in
  favour of racing only what we could show honestly.
- **Licensing was recorded as unverified rather than assumed.** None of the eight
  archives contained a licence file or a source URL. Every model went into the
  credits manifest marked `UNVERIFIED`, with the Sketchfab URL field marked
  *pending*. That gate is still open, and it is written down everywhere so it
  cannot be forgotten.

---

## 2. Asset intake: 600 MB of archives into 23 MB of runtime

### What arrived

Eight zips totalling around 600 MB. The circuit was a single 92.8 MB GLB with 1.37
million triangles, 161 materials and 145 textures. The cars ranged from 14 MB to
124 MB, three of them nested inside a second zip. They came from different
authors, which mattered more than expected later.

### The pipeline

Originals were preserved untouched under `work/assets-source/`, with a
provenance note per asset and the multi-hundred-megabyte archives kept out of
git. Runtime files were produced separately with `gltf-transform`: prune,
deduplicate, flatten, join, meshopt geometry compression, WebP textures.

- **Circuit:** 92.81 MB → **14.85 MB**, 1.37 M → 820 k triangles. A conservative
  simplification tolerance, and the world bounds checked against the original to
  within 0.1 m so nothing shifted.
- **Cars:** ~336 MB → **8.9 MB** for all seven. One outlier — the VCARB was ten
  times denser than the others at 649 k triangles and the error-based simplifier
  barely touched it. It needed an explicit weld and a ratio-targeted decimation
  before recompression, and that step was written into the build script so it is
  reproducible rather than a thing someone once did by hand.

The asset verifier had to learn a new format along the way. It had assumed plain
single-buffer GLBs; meshopt adds a zero-filled fallback buffer that is
deliberately absent from the file. Rather than switch to a less efficient
compression to satisfy the checker, the checker was taught meshopt's own
invariants — the fallback buffer, the compressed-view bounds, and the rule that a
view's length equals its element count times stride. The validator ended up
stricter than it started.

---

## 3. The track was fitted, not drawn

This is the part of the project I would point to first.

The obvious approach was to trace the circuit from a picture and hope it lined up
with the mesh. Instead, the racing line was **derived from the model itself**.

The GLB contained a material called `raceline`. It turned out not to be a single
racing line but the painted white boundary on *both* sides of the track — about
9.5 km of paint for a 5.45 km lap. That made a cleaner target than a racing line
would have been: the local centroid of the paint on both edges *is* the track
centre.

So a cursor marched around the loop. At each step it took the paint inside a
forward-facing disc, used the centroid as the next point, damped the heading so
it could not double back or divert down the pit lane, and stepped on. Six hundred
and more steps later it closed the loop within nine metres of where it began.

Then came the number that validated everything. The fitted loop measured
**5340 m. The real Shanghai lap is 5451 m.** Two percent short, which is exactly
what a smoothed centreline should be against an official distance measured along
the racing line. One figure confirmed the fit was right *and* that the model was
authored in metres.

Everything else came from named geometry inside the same mesh:

- `sha_banner_startfinish_a` gave the start/finish line.
- `sha_banner_pitentrance_a` and `lg_pit_exit_light_b` gave pit entry and exit —
  and because entry sat at high X and exit at low X, they also gave the **racing
  direction** without a guess.
- `sha_gridlines_a` gave the grid. `Pit_lane` gave the pit lane.

Pit entry landed at 95.6% of the lap, the start/finish line at 0, pit exit at
2.8%. That is exactly the order a main-straight pit lane has. The geometry was
telling the truth, and the generator is a script — run it again and you get the
same track.

The same idea then repeated up the stack. Circuit maps on the browse pages are
traced from this centreline, so the map and the raced surface cannot drift
apart. Later, corner annotations were positioned by lap fraction along it. One
source of truth, used everywhere.

---

## 4. It rendered nothing — and the tests were green

With the track fitted, the cars normalised, the grid cut and every unit test
passing, the app was run in a browser for the first time. The viewport was a flat
blue rectangle.

What followed is the strongest argument in this project for actually running the
thing.

**The far plane.** The camera's far clip was 520 m — fine for a track that fit in
±90 units, but Shanghai spans 1.2 km and the overhead camera sits 1.6 km up. The
entire circuit was beyond the clip. First fix; still blank.

**The context died.** The console eventually said `THREE.WebGLRenderer: Context
Lost.` Seven car models at 1024 px textures had cost enough decompressed video
memory to lose the GPU outright. Textures dropped to 512 px. Still blank.

**The quality tier lied.** The browser pane started narrow, the app measured the
viewport once at first render, fed that result back into itself as a "coarse
pointer" signal, and latched onto mobile quality forever — which meant the real
car models were never even requested. It now re-measures on resize. Still blank.

**Then the real one.** A probe written into the DOM (because page globals were
invisible from the test harness) reported the track was *in the scene*: 154
meshes, correct world bounds, `visible: true`. It was simply not being drawn.
`Box3.setFromObject` works on detached objects too. The clone had been **removed
from the scene graph** — the disposal helper called `removeFromParent()`, and
React StrictMode runs effects mount → cleanup → mount, so the second mount found
an orphan and never re-attached it.

That bug had been in the codebase all along. It had affected the Monaco track
too. Nobody had noticed because the Monaco GLB was rendered with
`visible={false}`.

Four bugs, one afternoon, none of them reachable by the type checker or by a
green test suite. The principle that came out of it is now written into the
project's vision document: *a passing suite proves the code does what we told it
to; running it proves we told it the right thing.*

---

## 5. Cameras, type, and the HUD

With the circuit visible, the camera system was rebuilt around its geometry.
Twelve trackside anchors were generated from the spline — placed on the *outside*
of each corner using local curvature, so cars turn into frame rather than away
from it — covering the Turns 1–4 spiral, the switchback, the long right, the back
straight and the hairpin. Three new modes joined the existing set: **Trackside**,
**Aerial** and **Drone**, each with its own damping so fixed cuts snap and follow
rigs glide.

Typography was two fonts the owner supplied: Formula1 Display and Wide, plus
MonoSpec for numerals. The first pass used Wide too liberally, and the owner's
note was blunt and correct — *it is very hard to read when you put it on text*.
The rule that came out of it is now enforced across the stylesheet: Wide only for
headings at 1.5rem and above, and only ever a few words. Every ticking numeral
uses MonoSpec with tabular figures so digits do not jitter.

---

## 6. From simulation to product

### The research

Before designing anything around the simulation, the question was who it was
for. The numbers reframed it. Formula 1 has more than 830 million followers, up
64% in seven years. Three quarters of new fans are women; 43% of the audience is
under 35. But only **16% credit Drive to Survive** — 39% came in through friends
and family. People arrive through *people and story*, and then hit a wall of
jargon: tyre compounds, undercuts, DRS detection points.

That gap — between loving the sport and understanding it — became the product.

### The concept

A landing experience was prototyped first as a live HTML page rather than a
document, so it could be reviewed as the thing it would become. Drawing on a
catalogue of the F1 2019 game interface for its design language — persistent top
nav, mosaic dashboard, dense stat panels, a bottom button legend — it mocked up
five screens and, at its centre, one idea: **Explain Mode**.

### What was built

- **A browse shell** with a dependency-free hash router, so the product stays a
  static build that runs from any host with no server rewrite rules.
- **Explain Mode.** A pure function from a race event plus the surrounding state
  to a plain-English reason, testable without a renderer. Its governing rule:
  *"Hamilton pitted" is not an explanation, it is a restatement.* The explanation
  is the tyre cost that made staying out slower. An overtake resolves to fresher
  tyres or DRS depending on the actual wear delta between those two cars.
- **A glossary** with keyboard-accessible tooltips, and a **quiz** that draws its
  explanations from that same glossary — so what is taught and what is tested
  cannot disagree.
- **Predict the Podium.** Pick three for a daily seed; the real engine runs that
  seed to completion and scores the call. Determinism is what makes it a
  prediction rather than a coin toss.
- **Find My Driver.** Six questions matched against the *same ratings the
  simulation races with*, so the driver you get genuinely behaves as you
  answered.

A contrast bug the owner spotted — a button's lime fill vanishing on hover,
leaving dark text on a dark panel — turned out to be one of three of the same
kind, including the quiz's answer feedback being dimmed by a global disabled
style at the exact moment it needed reading. A computed-contrast audit across the
browse pages then came back with zero WCAG AA failures.

---

## 7. Real data, and a data source that was wrong

The OpenF1 API sends `access-control-allow-origin: *`, so the browser calls it
directly and the product stays backend-free. It was wired in for results,
drivers, stints, telemetry and weather — strictly best-effort, with an 8-second
timeout and every failure resolving to nothing, so a blocked request degrades to
a plain message rather than breaking the page.

Two verification results came out of it. Our fourteen drivers were **already
correct** — every number, name and team matched the real 2026 grid. And the
eight placeholder circuits invented earlier were replaced with the real 23-round
calendar.

But OpenF1's calendar disagreed with formula1.com, and OpenF1 was wrong: an extra
Sakhir round in April, a Jeddah round the official calendar omits, and a "Kuala
Lumpur" meeting filed under Bahrain — there has been no Malaysian Grand Prix
since 2017. The official source won, and a test now guards against the phantom
round returning. The Shanghai page correctly reports Antonelli's win at
1:33:15.607, and the real race was 56 laps — the number the simulation had
already been using.

---

## 8. Making it watchable

The owner's feedback at this point was direct: the cars were jittery, far too
fast to follow, and overlapping each other. And one instruction reframed the
whole task — *this is a virtual thing, not a real one; don't mimic real life,
just make it enjoyable to watch.*

That mattered, because the first version of the plan had treated it as a fidelity
problem. It was not. It was three specific defects and one dial.

**The jitter** was not the smoothing; it was what the smoothing was chasing.
Every frame, the car container subscribed to state that changes every tick, so
React re-rendered all fourteen cars sixty times a second — each sampling the
spline twice *during render* — before the lerp moved toward a target that was
already stale. Motion moved off the React render path entirely: each car reads
its live state inside the frame loop and mutates its own transform. Measured
result with all fourteen cars running: **113 fps, worst frame 13.9 ms.**

**The wheels** had been accumulating total race distance into a rotation value
that reached ~695,000 radians by the end, losing angular precision. They now spin
from distance actually covered on screen, wrapped to one turn.

**The speed** was the dial. The engine had been compressing a real 56-lap race
into a six-minute window — roughly **twelve times real speed**. The default
became 20 laps across ten minutes, about 2.5×. And twenty was a floor found by
running it: at ten laps the tyres barely wore, nobody pitted, and there was no
strategy left for Explain Mode to explain.

**The spacing** was the instructive one, because the first fix was wrong.
Holding cars apart inside the engine seemed obvious — until a held-back car
finished the race a lap short, because clamping its progress had permanently
robbed it of distance. Spacing is a *presentation* concern; the race must stay
authoritative. It moved to the renderer, and then still was not enough, because
the real cause was upstream: the whole field sat within **1.5%** of each other on
pace, and dirty air was a flat 1% penalty too weak to make a following car ever
drop back. The pace spread was widened, dirty air made to scale with proximity,
and the visual spacing made to cascade so a train of three cannot collapse
together. Field spread went from **0.07 to 0.38 of a lap**; the smallest gap
anywhere from 1 m to 29 m.

---

## 9. Where it is going

The next step was the owner's idea, and it is the strongest one in the project:
**give the user the pit wall.** Hover a driver, call the stop, choose the
compound, tell them to push or conserve. Plenty of games let you drive an F1 car;
none let you be the strategist.

It fits everything built so far. The engine already has a per-driver controller
seam, so player commands plug into a hook that exists. Explain Mode stops being a
commentary track and becomes a feedback loop — *your stop came three laps early
and you rejoined in dirty air*. And it teaches the sport the only way that
sticks: by making you live the trade-off.

The design risk is stated up front. A command panel is only fun under time
pressure. If you can pause and deliberate forever, it is a spreadsheet with cars
attached. The tension has to come from decisions that expire.

---

## 10. What the process taught

**Derive, never invent.** The racing line, the circuit maps, the quiz
explanations, the driver matching — every time two things had to agree, they
were made the same thing. Nothing was hand-drawn that could be fitted.

**Say what is missing.** Twenty-three circuits, one playable, twenty-two saying
so — with a test that fails if a fake outline ever appears.

**Believe the running application.** The four bugs that mattered most were
invisible to a green suite. Run it.

**Fix things where they belong.** Spacing in the engine broke the race. Spacing
in the renderer fixed the picture. Knowing which layer owns a problem is most of
solving it.

**Let the owner's eye redirect the plan.** *Too fast to follow. The font is
hard to read. The cars are overlapping.* Each of those was more precise than the
plan it corrected.

**Write the risk down.** The licensing gate has been open since the first day,
and it is recorded in every place that could otherwise let someone forget it.
That is not a solved problem. It is an honestly unsolved one.
