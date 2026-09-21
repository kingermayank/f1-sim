# Recorded sound effects (optional)

The driving game is fully playable on its synthesised audio. Recordings placed
here are layered on top when present and silently skipped when absent. The
loader (`src/game/sfx.ts`) fetches each file once and never blocks the game.

## Source and licence

All clips come from **freesfx.co.uk**. Their End User License Agreement allows
use in games, commercial or not, provided the project credits
**http://www.freesfx.co.uk** — the credit is shown in the app's Credits and
recorded in `src/assets/credits.json`. The clips may not be redistributed on
their own, so the files are gitignored: each developer downloads them with a
free freesfx account and drops them in here.

## Files

The ID3 tags identify these as Sound Ideas (Series 1000, Digiffects) library
recordings, distributed through freesfx.co.uk by the same company, so the
freesfx credit terms apply. Each file below was cut from the freesfx download
with ffmpeg (trim, fades, loudness-normalised); the freesfx id is in brackets.

| File | From | Cut | Used for |
| --- | --- | --- | --- |
| `f1-onboard-loop.wav` | Sound Ideas F1, steady revs (13458) | 4.4–10.9 s, 0.5 s crossfade into a seamless 6 s loop, −18 LUFS, mono WAV so the loop is sample-exact | The player's engine, pitched by RPM |
| `f1-passby.mp3` | Formula 1 Race Cars Pass By Fast (13461) | 0.3–4.8 s, fades, −16 LUFS | Pass-by, panned to its side |
| `f1-passby-b.mp3` | Digiffects "Formula 1, several passing" (18920) | 0.6–5.0 s, fades, −16 LUFS | Second pass-by voice, chosen at random |
| `f1-ambience.mp3` | Formula 1 Racing (13462) | 0.3–29.3 s, 1 s crossfade loop, −20 LUFS | Trackside bed under the intro, grid and cool-down |
| `f1-straight.mp3` | Formula 1 Cars on Straight Away (13463) | 0–79.5 s, fades, −20 LUFS | Flyover bed under the intro |

## Before shipping

`src/assets/credits.json` is verified against files on disk, so it gets its
freesfx entry only once the clips are actually present and committed to a
release build. The entry must carry: creator "freeSFX / The Brian Nimens
Corporation Limited", source `https://freesfx.co.uk/sfx/formula`, the EULA URL
`https://freesfx.co.uk/Page/4/End-User-License-Agreement`, the download date,
each runtime path, the trims applied, and the credit line
"Sound effects from http://www.freesfx.co.uk", which the app must display.
