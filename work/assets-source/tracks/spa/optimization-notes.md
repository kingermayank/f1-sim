# Circuit de Spa-Francorchamps optimization notes

- Source archive: `/Users/mayankkinger/Downloads/circuit-de-spa-francorchamps-2022-layout.zip`
- Preserved staged archive: `/Users/mayankkinger/Documents/Codex/2026-08-04/f1-simulation/.worktrees/feat-f1-simulation/work/assets-source/tracks/spa/original/circuit-de-spa-francorchamps-2022-layout.zip`
- Source archive SHA-256: `feaeb0b45eb1bca00e558504fc101d879bd7449faaa45db19a2c7464a1e5ee0f`
- Optimized runtime: `/assets/models/tracks/spa.glb`
- Runtime bytes: 14,354,528 (30,000,000-byte default limit; no exception required)
- Runtime SHA-256: `1fdb587d3f7fc07509f549fef1214a4073f7f64a751845c53c4de79a4c10d9a8`
- Geometry: 645,943 triangles, 1 meshes, 85 materials
- Centerline source: material `groove_custom.001, groove1.001, groove3.001, groove2.001`, transformed by its preserved GLB node world matrix
- Pit source: material `asph-pitlane-old.001`
- Fitted lap: 6947.99 m versus 7004 m official (-0.800%)
- Seam bridge review: 44 m was rejected (Primary march stopped after 5675.8 m with a 757.7 m closure gap; no forward source vertices were found at 22, 33, or 44 m, while three existed inside 66 m.)
- Accepted seam evidence: The 70 m search bound reaches only forward vertices from the selected GLB groove materials; the accepted march selects a maximum 53.61 m cursor-to-source continuation (52.88 m between its nearest exact source vertices), without manual route points.
- Maximum bridge endpoints: cursor [475.891, 46.887, 169.278], nearest source [476.137, 46.888, 169.972], target source [492.731, 49.308, 220.118]; cursor [526.145, 54.172, 321.098], nearest source [525.918, 54.172, 320.412], target source [509.324, 51.745, 270.265]
- Licensing: **UNVERIFIED**, local prototype only; publication is not allowed.

The optimizer used mesh deduplication, instancing/palette consolidation, flatten/join/weld, conservative simplification (0.001 error), WebP textures at 1024 px, pruning, and meshopt compression. Reproducible extracted and optimized staging GLBs may be removed after publishing, but the original archives, public runtime, manifests, notes, and diagnostics must remain.
