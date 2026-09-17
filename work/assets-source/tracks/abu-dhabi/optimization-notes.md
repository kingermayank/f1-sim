# Yas Marina Circuit optimization notes

- Source archive: `/Users/mayankkinger/Downloads/yas-marina-circuit-abu-dhabi-2021-layout.zip`
- Preserved staged archive: `/Users/mayankkinger/Documents/Codex/2026-08-04/f1-simulation/.worktrees/feat-f1-simulation/work/assets-source/tracks/abu-dhabi/original/yas-marina-circuit-abu-dhabi-2021-layout.zip`
- Source archive SHA-256: `6fa4490b42b4f75d3cd6f4127067c72ff00c9ced4b482b78c24c0bd22f0fcc7e`
- Optimized runtime: `/assets/models/tracks/abu-dhabi.glb`
- Runtime bytes: 13,874,976 (30,000,000-byte default limit; no exception required)
- Runtime SHA-256: `948b1865657b5481190678e155947b8ed16375c38dc3de204b589b756df3aabb`
- Geometry: 584,744 triangles, 1 meshes, 186 materials
- Centerline source: material `rmbl_s, roada`, transformed by its preserved GLB node world matrix
- Pit source: material `roada`
- Pit selection: 3442 of 75743 source vertices within 120 source units (134.80 m calibrated) of the GLB start-marker material centroid
- Source-aligned loop: 4701.13 asset-space units; distance scale: 1.12334801 m/source unit
- Fitted lap metadata: 5281.00 m versus 5281 m official (0.000%)
- Asset-space calibration: The supplied GLB uses arbitrary asset-space units. The complete source-aligned Grand Prix loop remains in those coordinates for exact visual registration; only its simulation distance metadata is calibrated to the official 5,281 m lap.

- Licensing: **UNVERIFIED**, local prototype only; publication is not allowed.

The optimizer used mesh deduplication, instancing/palette consolidation, flatten/join/weld, conservative simplification (0.001 error), WebP textures at 1024 px, pruning, and meshopt compression. Reproducible extracted and optimized staging GLBs may be removed after publishing, but the original archives, public runtime, manifests, notes, and diagnostics must remain.
