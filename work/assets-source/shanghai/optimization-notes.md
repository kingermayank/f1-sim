# Shanghai International Circuit (2018 layout) — asset intake

## Provenance (INCOMPLETE — licensing gate OPEN)

| Field | Value |
| --- | --- |
| Supplied archive | `shanghai-international-circuit-2018-layout.zip` |
| Source model | `source/shanghai_compressed.glb` |
| Sketchfab page URL | **UNRECORDED — required before publication** |
| Creator | **UNRECORDED — required before publication** |
| License | **UNVERIFIED — required before publication** |
| Download date | Unknown (archive supplied by the project owner) |
| License/readme in archive | None present |

The authorized download contained no license or readme file, so permission to
modify and redistribute has **not** been confirmed. This asset is cleared for
local prototype use only until the page URL, creator, and license are recorded.

## Runtime optimization

- Payload: 92.81 MB → **14.85 MB**
- Triangles after optimization: 820,303 (from 1,366,382)
- Pipeline: `gltf-transform optimize` — prune, dedup, flatten, join, palette,
  meshopt geometry compression, WebP texture recompression.
- World transform preserved, so runtime geometry stays aligned to the
  authoritative spline and grid coordinates.

- Textures capped at 1024 px; the source set was already small (145 maps, mostly 256 px).
- Simplification error tolerance 0.0001; scene bounds shifted by <0.1 m, verified
  against the original so the fitted centerline still aligns.
- Preserved: Turns 1–2 spiral, back straight, hairpin, pit complex, grandstands.

## Trademark caution

The source textures include third-party sponsor marks (Rolex, Emirates, Pirelli,
Heineken, Petronas, LG, Allianz, F1 boards). These are **not** project-original
and are not covered by any verified license. They must be reviewed or replaced
with neutral boards before any public distribution.
