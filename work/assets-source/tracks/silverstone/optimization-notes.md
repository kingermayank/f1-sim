# Silverstone Circuit optimization notes

- Source archive: `/Users/mayankkinger/Downloads/silverstone-circuit-2024-layout.zip`
- Preserved staged archive: `/Users/mayankkinger/Documents/Codex/2026-08-04/f1-simulation/.worktrees/feat-f1-simulation/work/assets-source/tracks/silverstone/original/silverstone-circuit-2024-layout.zip`
- Source archive SHA-256: `0ffd0e81d7039139ff691f4e39521597248e80652e2e234d5919f8929ed39076`
- Optimized runtime: `/assets/models/tracks/silverstone.glb`
- Runtime bytes: 18,201,852 (30,000,000-byte default limit; no exception required)
- Runtime SHA-256: `f44429d916b951202561faafdab0c45c5409d02f68546340bddf4fc7fca402da`
- Geometry: 730,998 triangles, 6 meshes, 61 materials
- Centerline source: material `groove2.001, groove3.001, groove.001, asphalt.001`, transformed by its preserved GLB node world matrix
- Pit source: material `asph_pitlane.001`
- Pit selection: 166 of 385 source vertices within 450 m of the GLB start-marker material centroid
- Fitted lap: 5844.60 m versus 5891 m official (-0.788%)
- Licensing: **UNVERIFIED**, local prototype only; publication is not allowed.

The optimizer used mesh deduplication, instancing/palette consolidation, flatten/join/weld, conservative simplification (0.001 error), WebP textures at 1024 px, pruning, and meshopt compression. Reproducible extracted and optimized staging GLBs may be removed after publishing, but the original archives, public runtime, manifests, notes, and diagnostics must remain.
