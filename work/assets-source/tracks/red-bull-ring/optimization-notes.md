# Red Bull Ring optimization notes

- Source archive: `/Users/mayankkinger/Downloads/redbull-ring-2025-layout.zip`
- Preserved staged archive: `/Users/mayankkinger/Documents/Codex/2026-08-04/f1-simulation/.worktrees/feat-f1-simulation/work/assets-source/tracks/red-bull-ring/original/redbull-ring-2025-layout.zip`
- Source archive SHA-256: `c9d28259ee938ddbbbbf2cc0887f703bf4c4b066cd6e792b4b4d6e734137caa5`
- Optimized runtime: `/assets/models/tracks/red-bull-ring.glb`
- Runtime bytes: 11,518,576 (30,000,000-byte default limit; no exception required)
- Runtime SHA-256: `aecb3ab218a463eab4c1cdf45dedfde5ff38e558cebd8cbdbbdd6edb8dc1af91`
- Geometry: 432,587 triangles, 2 meshes, 134 materials
- Centerline source: material `Acuredbullring201Mtl.003`, transformed by its preserved GLB node world matrix
- Pit source: material `Acuredbullring131Mtl.003`
- Pit selection: 475 of 615 source vertices within 300 m of the GLB start-marker material centroid
- Fitted lap: 4310.41 m versus 4318 m official (-0.176%)
- Licensing: **UNVERIFIED**, local prototype only; publication is not allowed.

The optimizer used mesh deduplication, instancing/palette consolidation, flatten/join/weld, conservative simplification (0.001 error), WebP textures at 1024 px, pruning, and meshopt compression. Reproducible extracted and optimized staging GLBs may be removed after publishing, but the original archives, public runtime, manifests, notes, and diagnostics must remain.
