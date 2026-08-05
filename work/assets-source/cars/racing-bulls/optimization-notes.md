# Visa Cash App RB VCARB01 — asset intake

## Provenance (INCOMPLETE — licensing gate OPEN)

| Field | Value |
| --- | --- |
| Supplied archive | `visa-cash-app-red-bull-racing-vcarb01.zip` |
| Source model | `source/vcarb01.zip → untitled.gltf` |
| Sketchfab page URL | **UNRECORDED — required before publication** |
| Creator | **UNRECORDED — required before publication** |
| License | **UNVERIFIED — required before publication** |
| Download date | Unknown (archive supplied by the project owner) |
| License/readme in archive | None present |

The authorized download contained no license or readme file, so permission to
modify and redistribute has **not** been confirmed. This asset is cleared for
local prototype use only until the page URL, creator, and license are recorded.

## Runtime optimization

- Payload: 49.79 MB → **840 KB**
- Triangles after optimization: 77,924 (from 649,421)
- Pipeline: `gltf-transform optimize` — prune, dedup, flatten, join, palette,
  meshopt geometry compression, WebP texture recompression.
- World transform preserved, so runtime geometry stays aligned to the
  authoritative spline and grid coordinates.

- This source was ~10x denser than the other cars, so it needed an explicit
  weld + ratio-targeted simplify (0.12) before recompression.
