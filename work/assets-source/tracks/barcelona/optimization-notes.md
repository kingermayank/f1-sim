# Circuit de Barcelona-Catalunya optimization notes

- Source archive: `/Users/mayankkinger/Downloads/barcelona-catalunya-grand-prix-2023-layout.zip`
- Preserved staged archive: `/Users/mayankkinger/Documents/Codex/2026-08-04/f1-simulation/.worktrees/feat-f1-simulation/work/assets-source/tracks/barcelona/original/barcelona-catalunya-grand-prix-2023-layout.zip`
- Source archive SHA-256: `52f298573963bdc2029cd60ce4f8f0692e260e1852ddbf128cd91b4da4050fcc`
- Optimized runtime: `/assets/models/tracks/barcelona.glb`
- Runtime bytes: 14,264,976 (30,000,000-byte default limit; no exception required)
- Runtime SHA-256: `8d970a92e22e1d84563b7223f4248a0a9f93d4f981ba58d9314cc2ad2645c7a5`
- Geometry: 520,267 triangles, 1 meshes, 118 materials
- Centerline source: material `STRP_PITSKIDS02, ROAD_TRACKMAIN_L, ROAD_TRACKMAIN`, transformed by its preserved GLB node world matrix
- Pit source: material `rdpitla`
- Fitted lap: 4543.31 m versus 4657 m official (-2.441%)
- Licensing: **UNVERIFIED**, local prototype only; publication is not allowed.

The optimizer used mesh deduplication, instancing/palette consolidation, flatten/join/weld, conservative simplification (0.001 error), WebP textures at 1024 px, pruning, and meshopt compression. Reproducible extracted and optimized staging GLBs may be removed after publishing, but the original archives, public runtime, manifests, notes, and diagnostics must remain.
