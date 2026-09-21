# Plan — the driving game

The owner has decided: a real racing game. Choose a track, choose a car, drive
it yourself with the keyboard against the AI field. Five laps. Physics, sound,
DRS, a proper HUD. This document is the build plan for that.

## The loop

`Choose race` → pick circuit → pick car → **race** → result → race again.

Watch mode stays exactly as it is. The game is a separate route (`#/play`)
built beside it, sharing the circuit model, car models, spline and engine.

## Architecture

```
src/game/
  track-projection.ts   dense spline sample; nearest-point + lap-fraction lookup
  car-physics.ts        pure arcade car model — testable with no renderer
  input.ts              keyboard state (WASD / arrows, shift = DRS, R = reset)
  game-store.ts         session: phase, player car, AI engine, laps, position, DRS
  engine-audio.ts       procedural engine note driven by RPM + gear, tyre scrub
  GameScene.tsx         Canvas: circuit, AI cars, player car, chase camera
  GameHud.tsx           speed, gear, lap, position, gap, DRS, off-track
  ChooseRace.tsx        circuit → car → go
  RaceResult.tsx        classification, best lap, retry
```

## The car model

Arcade, but grounded in the real forces so it *feels* right:

- **Longitudinal:** engine force minus aero drag (∝ v²) minus rolling
  resistance; braking is a strong constant decel. Top speed ~305 km/h.
- **Steering:** bicycle model. Yaw rate = v / wheelbase · tan(steer). Steering
  lock shrinks with speed so the car stays stable at 300 km/h and turns
  sharply at 80.
- **Grip:** a lateral grip limit that rises with speed (a stand-in for
  downforce). Ask for more yaw than grip allows and the car understeers —
  it does not spin, it runs wide. That is what makes it drivable on a keyboard.
- **Off track:** lateral distance from the spline beyond half the track width
  means grass: grip ×0.4, drag ×3. You lose time; you do not crash.
- **DRS:** in a DRS zone and within one second of the car ahead, hold Shift to
  drop drag 20% and lift top speed. The rule teaches itself.
- **Gears:** derived from speed for the HUD and the engine note.

## The AI

The existing deterministic engine drives the other thirteen cars on the spline.
`advance()` takes presentation seconds and applies its own compression, so the
presentation window becomes the **difficulty dial**: a window equal to
`laps × 76.2 s` makes the AI run at real pace; longer is easier.

## Lap and position

Player progress is the nearest-spline-point lap fraction, so it lives in the
same 0–1 space the AI uses (0 = start/finish). A lap counts when the fraction
wraps forward past the line. Position is player `lap + fraction` against every
AI car's `lap + distance`.

## Sound

Procedural, extending the existing Web Audio engine: two oscillators pitched by
RPM (RPM from speed and gear), a gear-shift dip, filtered noise for tyre scrub
that rises with lateral slip, and a crowd bed. No sampled audio, so nothing
new to license.

## Build order

1. Projection + physics, with unit tests (pure, no renderer).
2. Game store: player + AI running together, laps and position correct.
3. Scene: circuit, AI cars, player car, chase camera. Drive it.
4. HUD and DRS.
5. Sound.
6. Choose-race flow and result screen; route from the home page.
7. Verify in the browser; E2E for the flow.
