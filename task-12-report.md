# Task 12 Report: Audio and Accessibility Preferences

## Delivered

- Added an injected, testable `RaceAudioController` that creates no `AudioContext` until `resume()` is called from a user interaction.
- Added two conservative synthesized engine layers driven by the selected car's speed, plus filtered crowd/tire noise and short pit/impact envelopes.
- Muting suppresses event envelopes and ramps the master output to zero; disposal stops sources, disconnects owned nodes, and closes the context.
- Added a single application audio bridge so snapshots/events feed one controller without duplicate contexts or autoplay.
- Added versioned, validated preferences for audio mute, reduced motion, labels, effects, quality, and camera mode.
- Local storage reads/writes and Web Audio initialization fail closed without breaking the simulation.
- System `prefers-reduced-motion` supplies the initial value until the user explicitly overrides it; the explicit preference can disable or enable reduced motion.
- Existing Audio, Motion, FX, Labels, Quality, and Camera controls now persist and continue to drive their scene behavior.

## Test-first evidence

The new audio and store tests were run before implementation and failed for the missing audio module, missing preference hydration, and missing system reduced-motion handling. The UI test then failed because unmuting did not resume audio. Each contract was implemented only after its corresponding RED result.

## Verification

- `npm test -- tests/simulation/race-audio.test.ts tests/store/race-store.test.ts tests/ui`: 6 files, 36 tests passed.
- `npm run build`: TypeScript check and Vite production build passed.
- Headless Google Chrome smoke at 1440x900: application heading and audio control loaded; unmute worked; Labels, FX, Motion, Quality, and Camera preferences survived reload; zero page errors.

Playwright's bundled browser was not installed, so the smoke used the locally installed Google Chrome executable through Playwright. Existing Three.js deprecation warnings were observed from the development server and are unrelated to Task 12.

Task 13 was not started.

## Review follow-up

- Removed the camera's independent media-query override. `reducedMotion` in the race store is now the single resolved value used by both cameras and effects.
- Added live system preference synchronization: system changes update the store while the persisted override is `null`; after an explicit user choice, later system changes are ignored, including when that choice is `false`.
- Added idempotent `ended` cleanup for pit and impact envelope subgraphs. Transient sources, filters, and gains disconnect and leave the controller ownership sets when playback ends, while disposal remains safe if it races with `ended`.
- Added regression coverage for dynamic reduced-motion resolution and repeated one-shot events returning live audio-node counts to the persistent graph baseline.
