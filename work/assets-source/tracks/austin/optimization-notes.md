# Circuit of the Americas optimization notes

- Source archive: `/Users/mayankkinger/Downloads/austin-circuit-of-the-americas-2012-layout.zip`
- Preserved staged archive: `/Users/mayankkinger/Documents/Codex/2026-08-04/f1-simulation/.worktrees/feat-f1-simulation/work/assets-source/tracks/austin/original/austin-circuit-of-the-americas-2012-layout.zip`
- Source archive SHA-256: `ac1d58aeb90957a8c62936217c302c134f05cdf0944fb469c7153efb7e1c61f5`
- Optimized runtime: `/assets/models/tracks/austin.glb`
- Runtime bytes: 7,664,944 (30,000,000-byte default limit; no exception required)
- Runtime SHA-256: `575134ec539a0b83cfac1a7c1f36c4d36156a057cd4b7b2792d5af721f070aff`
- Geometry: 357,934 triangles, 1 meshes, 140 materials
- Centerline source: material `roada`, transformed by its preserved GLB node world matrix
- Pit source: material `roadpitlane`
- Fitted lap: 5475.29 m versus 5513 m official (-0.684%)
- Licensing: **UNVERIFIED**, local prototype only; publication is not allowed.

The optimizer used mesh deduplication, instancing/palette consolidation, flatten/join/weld, conservative simplification (0.001 error), WebP textures at 1024 px, pruning, and meshopt compression. Reproducible extracted and optimized staging GLBs may be removed after publishing, but the original archives, public runtime, manifests, notes, and diagnostics must remain.
