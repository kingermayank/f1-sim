# APEX — what we are building, and why

> Formula 1, finally legible.

APEX is a browsable home for Formula 1 — circuits, cars and drivers — wrapped
around a deterministic 3D race simulation. You watch a race unfold on a real
circuit, and the product tells you **why** it unfolded that way.

It is not a stats site. It is not a game about lap times. It is an attempt to
close the gap between loving this sport and understanding it.

---

## 1. The problem

Formula 1 has more than **830 million followers, up 64% in seven years**. Three
quarters of new fans are women. Forty-three percent of the audience is under 35.
By any measure, the sport is winning.

But look at how people actually arrive. Only **16% credit Drive to Survive**;
**39% came in through friends and family**. They arrive through *people, rivalry
and story* — not through lap charts and tyre windows.

Then the sport hands them this:

> "He's boxing to undercut Norris, but he'll come out in dirty air behind the
> Aston, and the softs won't take another twelve laps in these temperatures."

Every word of that is load-bearing. None of it is explained. The newcomer nods,
loses the thread, and quietly becomes a casual viewer who watches the start and
the finish.

**That drop-off — between "I love this" and "I understand this" — is the entire
opportunity.** Nothing on the market sits in it. Official timing apps are built
for people who already know. Fantasy leagues are for the committed. YouTube
explainers are passive and disconnected from the race you are actually watching.

---

## 2. The narrative

The experience is built around one person's arc.

**They arrive curious.** A friend got them watching. They know Verstappen is fast
and Hamilton is famous. They could not tell you what a pit window is, and they
are slightly embarrassed about it.

**They find someone to care about.** Six questions — *"A gap opens up, but it is
half a gap at best. You…"* — and they leave with a driver whose style matches how
they answered. This matters more than it sounds. People pick a driver before they
pick a team, and caring about someone is the strongest predictor that they come back.

**They watch a race.** Real circuit, real cars, cinematic cameras. It looks like
the sport they saw on television.

**And then the product does the thing nothing else does.** A car pits, and instead
of an unexplained event, they get:

> **Hamilton came into the pits**
> His tyres were badly worn at around 82% wear. Once *degradation* costs more per
> lap than the roughly twenty-four seconds a stop takes, staying out is the slower
> option.

Every underlined word opens its own plain-language definition. Nothing is
assumed. Nothing is dumbed down.

**They start to predict.** Having understood *why* the last stop happened, they
begin to see the next one coming. That is the moment a viewer becomes a fan —
when the race stops being a sequence of events and becomes a chain of decisions.

**Then they want to argue with it.** *What if he had pitted two laps later?*
Because the simulation is deterministic and seeded, we can actually answer that.
No broadcast on earth can.

---

## 3. The ethos

These are not aspirations. Every one of them is visible in the code, and most are
enforced by tests.

### Derive, never invent

The Shanghai racing line was not hand-drawn from a picture of the circuit. It was
**fitted to the supplied 3D model** by marching a cursor around the model's own
painted track boundaries. The start/finish line, the starting grid, the pit lane
and its entry and exit were all located from named geometry inside that same mesh.

The result measured **5340 m against the real circuit's 5451 m — 2% off**, which
validated both the fit and the model's scale in one number.

The same principle repeats everywhere:

- Circuit maps on the browse pages are traced from the **same centerline the cars
  drive**, so the map and the racing surface cannot drift apart.
- The quiz draws its explanations from the **same glossary** that powers the
  in-race tooltips, so what we teach and what we test cannot disagree.
- "Find My Driver" matches against the **same ratings the simulation races with**,
  so the driver you are matched with genuinely behaves the way you answered.

One source of truth, always. When two things must agree, we make them the same thing.

### Say what is missing

Twenty-three circuits are listed. **One is playable.** The other twenty-two say
"Not built yet" and carry no fake outline — a test fails if one ever appears.

The 2026 calendar is the real 23-round season. When the data source we use
disagreed with the official one — OpenF1 lists a "Kuala Lumpur" round filed under
Bahrain, and there is no Malaysian Grand Prix in 2026 — we took the official
source and left a test guarding against the phantom round returning.

We would rather show someone an honest gap than a convincing fiction.

### Explain the cause, not the event

The rule that governs every explanation in the product: **"Hamilton pitted" is not
an explanation.** It is a restatement. The explanation is the tyre cost that made
staying out slower.

An overtake resolves to *fresher tyres* or *DRS* depending on the actual wear delta
between those two cars in that moment — not a generic line. The tests assert that
each reason names its causal factor, not merely that a string was produced.

### Legibility is not decoration

Formula1 Wide is a beautiful display face and is genuinely hard to read at body
sizes. It is restricted to headings of 1.5rem and above, and to a few words at a
time. Everything else uses Formula1 Display; every ticking numeral uses MonoSpec
with tabular figures so digits do not jitter.

When a hover state stripped a button's fill and left dark text on a dark panel, the
fix was structural — the hover rule can no longer match that button at all, rather
than winning a specificity race that someone loses again later. A disabled button
whose label explains *why* it is disabled must stay readable; fading out the
explanation of a fade-out helps nobody.

### Determinism is a product feature

The simulation is seeded and reproducible. That is not a technical footnote — it
is the foundation of everything that makes this product defensible:

- A podium prediction is scored against a **real outcome**, not a coin toss.
- A counterfactual is genuinely computable. *What if?* has an answer.
- Everyone racing today's seed is solving the **same puzzle**, which is what makes
  a shared score meaningful.

### Real data enriches; it must never block

Live results come from OpenF1 with an 8-second timeout, a session cache, and a
failure path that resolves to nothing. If the API is down, blocked, or the viewer
is offline, the panel says so plainly and the rest of the product works exactly as
before. Real data is a gift, never a dependency.

### Believe the running application

The most valuable bugs in this project were invisible to the type checker and to a
green test suite. They only appeared when someone actually opened the thing:

- Models loaded with perfect transforms and **never drew**, because disposal
  detached them from the scene and React StrictMode's mount → cleanup → mount left
  them orphaned.
- The camera's far plane was 520 m on a **1.2 km circuit**, clipping the entire
  track away.
- Seven car models at 1024 px textures **lost the WebGL context outright**.
- The quality tier was measured once and fed back into itself, so a window that
  started narrow was stuck on mobile quality forever and never loaded the real cars.

A passing test suite proves the code does what we told it to. Running it proves we
told it the right thing.

---

## 4. Who it is for

**The curious newcomer — primary.** Wants to not feel stupid. Needs plain
language, no unexplained jargon, and a reason to care about a specific driver.

**The returning casual — secondary.** Watches a few races a season. Needs fast
catch-up and the ability to poke at a scenario without a 90-minute commitment.

**The strategy nerd — tertiary, and our distribution.** Not the target, but the
one who makes the counterfactual clips the newcomer sees. Build for the newcomer,
arm the nerd. Explain Mode is a toggle for exactly this reason — nobody should be
patronised by their own product.

---

## 5. Where it stands

**Built and verified**

- A deterministic 56-lap Chinese Grand Prix on the real Shanghai circuit, with
  seven licensed team cars, cinematic cameras, and a full timing HUD.
- A browse shell: landing, the real 23-round 2026 calendar, garage, drivers, learn.
- Explain Mode, with a glossary and accessible tooltips.
- A scored quiz, Predict the Podium with streaks, Find My Driver.
- Live results from OpenF1 — Shanghai correctly reports Antonelli's win.
- 161 unit tests, 10/10 end-to-end on desktop and mobile.

**Next**

The pit wall: let people *make* the strategy calls rather than watch them. It uses
the simulation we already have, teaches the exact concept that loses newcomers,
and turns a thing you watch into a thing you play.

After that: the counterfactual re-run, then real-moment replay in 3D once a second
circuit exists.

---

## 6. The honest risks

**The simulation must produce races worth explaining.** Everything above assumes
the generated racing is dramatic enough to be worth annotating. If it is not, no
amount of explanation saves it. This is cheap to check and worth checking before
investing further.

**The identities are unlicensed.** Real driver names, team liveries and car models
are recorded as `UNVERIFIED` in `src/assets/credits.json`, and the supplied circuit
carries third-party sponsor marks. This is fine for a private prototype. It is not
fine for a public one, and the cost of changing course grows with every feature we
build on top of real identities.

That decision should be made deliberately, and soon — not discovered later.

---

*A product that explains itself is worth more than a product that impresses you.*
