# Alpine A525 (2025) — asset intake

## Provenance (INCOMPLETE — licensing gate OPEN)

| Field | Value |
| --- | --- |
| Supplied archive | `2025-alpine-a525.zip` |
| Source model | `source/f1-2025_alpine_a525.glb` |
| Sketchfab page URL | **UNRECORDED — required before publication** |
| Creator | **UNRECORDED — required before publication** |
| License | **UNVERIFIED — required before publication** |
| Download date | Unknown (archive supplied by the project owner) |
| License/readme in archive | None present |

The authorized download contained no license or readme file, so permission to
modify and redistribute has **not** been confirmed. This asset is cleared for
local prototype use only until the page URL, creator, and license are recorded.

## Runtime optimization

- Payload: 63.25 MB → **2.8 MB**
- Triangles after optimization: ~95,000
- Pipeline: `gltf-transform optimize` — prune, dedup, flatten, join, palette,
  meshopt geometry compression, WebP texture recompression.
- World transform preserved, so runtime geometry stays aligned to the
  authoritative spline and grid coordinates.

