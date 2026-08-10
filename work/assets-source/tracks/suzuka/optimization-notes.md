# Suzuka Circuit optimization notes

- Source archive: `/Users/mayankkinger/Downloads/suzuka-circuit-2001-layout.zip`
- Preserved staged archive: `/Users/mayankkinger/Documents/Codex/2026-08-04/f1-simulation/.worktrees/feat-f1-simulation/work/assets-source/tracks/suzuka/original/suzuka-circuit-2001-layout.zip`
- Source archive SHA-256: `811261134c6930aa71a6da9c48f31b4646d55e166f0555cf4dce5bc4ae283919`
- Optimized runtime: `/assets/models/tracks/suzuka.glb`
- Runtime bytes: 9,580,468 (30,000,000-byte default limit; no exception required)
- Runtime SHA-256: `f1c557c2435db8263381e362d5dbd8996467712d88c014ba6c7e3f1705292b46`
- Geometry: 121,559 triangles, 3 meshes, 294 materials
- Centerline source: material `groove`, transformed by its preserved GLB node world matrix
- Pit source: material `PITROAD`
- Fitted lap: 5774.61 m versus 5807 m official (-0.558%)
- Licensing: **UNVERIFIED**, local prototype only; publication is not allowed.

The optimizer used mesh deduplication, instancing/palette consolidation, flatten/join/weld, conservative simplification (0.001 error), WebP textures at 1024 px, pruning, and meshopt compression. Reproducible extracted and optimized staging GLBs may be removed after publishing, but the original archives, public runtime, manifests, notes, and diagnostics must remain.
