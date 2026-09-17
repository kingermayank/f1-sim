# Marina Bay Street Circuit optimization notes

- Source archive: `/Users/mayankkinger/Downloads/marina-bay-street-circuit.zip`
- Preserved staged archive: `/Users/mayankkinger/Documents/Codex/2026-08-04/f1-simulation/.worktrees/feat-f1-simulation/work/assets-source/tracks/singapore/original/marina-bay-street-circuit.zip`
- Source archive SHA-256: `6fefd251ceb3db66e19a6cba493c4270c6676fd03db93f953bb99e5137c33614`
- Optimized runtime: `/assets/models/tracks/singapore.glb`
- Runtime bytes: 10,632,992 (30,000,000-byte default limit; no exception required)
- Runtime SHA-256: `a1d8e7e57444fd48b012fa0cb95a8504173b96b171126cebd2ddfe3821ee7975`
- Geometry: 431,482 triangles, 1 meshes, 188 materials
- Centerline source: material `151Mtl`, transformed by its preserved GLB node world matrix
- Pit source: material `11761Mtl`
- Fitted lap: 4951.23 m versus 4940 m official (0.227%)
- Licensing: **UNVERIFIED**, local prototype only; publication is not allowed.

The optimizer used mesh deduplication, instancing/palette consolidation, flatten/join/weld, conservative simplification (0.001 error), WebP textures at 1024 px, pruning, and meshopt compression. Reproducible extracted and optimized staging GLBs may be removed after publishing, but the original archives, public runtime, manifests, notes, and diagnostics must remain.
