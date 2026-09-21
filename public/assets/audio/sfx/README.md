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

| File | freesfx clip | Used for |
| --- | --- | --- |
| `f1-onboard-loop.mp3` | Inside Formula Car Around Track | The player's engine: a **steady full-throttle stretch of 3–6 s**, trimmed so the start and end pitch match and it loops without a click. Pitched by RPM at runtime. |
| `f1-passby.mp3` | Formula 1 Race Cars Pass By Fast | Played, panned to the side it happened on, whenever a rival is passed or passes you. |
| `f1-ambience.mp3` | Formula 500 General Ambience | Crowd and paddock bed under the intro flyover and the grid. |
| `f1-straight.mp3` | Formula 1 Cars on Straight Away | Reserved for the intro flyover bed. |

Export as MP3 at 44.1 kHz. Trim with any editor (Audacity: select → Edit →
Remove Special → Trim Audio; for the loop, apply a 5 ms fade at both ends).

## Before shipping

`src/assets/credits.json` is verified against files on disk, so it gets its
freesfx entry only once the clips are actually present and committed to a
release build. The entry must carry: creator "freeSFX / The Brian Nimens
Corporation Limited", source `https://freesfx.co.uk/sfx/formula`, the EULA URL
`https://freesfx.co.uk/Page/4/End-User-License-Agreement`, the download date,
each runtime path, the trims applied, and the credit line
"Sound effects from http://www.freesfx.co.uk", which the app must display.
