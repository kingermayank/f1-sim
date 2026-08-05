# Aston Martin Aramco AMR25 — asset intake

## Provenance (INCOMPLETE — licensing gate OPEN)

| Field | Value |
| --- | --- |
| Supplied archive | `aston-martin-aramco-amr25.zip` |
| Source model | `source/Aston Martin Aramco AMR25.glb` |
| Sketchfab page URL | **UNRECORDED — required before publication** |
| Creator | **UNRECORDED — required before publication** |
| License | **UNVERIFIED — required before publication** |
| Download date | Unknown (archive supplied by the project owner) |
| License/readme in archive | None present |

The authorized download contained no license or readme file, so permission to
modify and redistribute has **not** been confirmed. This asset is cleared for
local prototype use only until the page URL, creator, and license are recorded.

## Runtime optimization

- Payload: 63.40 MB → **1.5 MB**
- Triangles after optimization: ~70,000
- Pipeline: `gltf-transform optimize` — prune, dedup, flatten, join, palette,
  meshopt geometry compression, WebP texture recompression.
- World transform preserved, so runtime geometry stays aligned to the
  authoritative spline and grid coordinates.

