# Albert Park Circuit optimization notes

- Source archive: `/Users/mayankkinger/Downloads/albert-park-circuit-melbourne-2018-layout.zip`
- Preserved staged archive: `/Users/mayankkinger/Documents/Codex/2026-08-04/f1-simulation/.worktrees/feat-f1-simulation/work/assets-source/tracks/melbourne/original/albert-park-circuit-melbourne-2018-layout.zip`
- Source archive SHA-256: `b82352a837c520fdaa1a8440573086de0b4552c066617776cb06ec897d9d06db`
- Optimized runtime: `/assets/models/tracks/melbourne.glb`
- Runtime bytes: 18,390,052 (30,000,000-byte default limit; no exception required)
- Runtime SHA-256: `92760a754c959c9c358f8453ddbd01a2b7c4f7c288969254244818ca4e1c829f`
- Geometry: 842,970 triangles, 2 meshes, 186 materials
- Centerline source: material `asp-grp.004`, transformed by its preserved GLB node world matrix
- Pit source: material `pitlane.004`
- Fitted lap: 5242.48 m versus 5278 m official (-0.673%)
- Licensing: **UNVERIFIED**, local prototype only; publication is not allowed.

The optimizer used mesh deduplication, instancing/palette consolidation, flatten/join/weld, conservative simplification (0.001 error), WebP textures at 1024 px, pruning, and meshopt compression. Reproducible extracted and optimized staging GLBs may be removed after publishing, but the original archives, public runtime, manifests, notes, and diagnostics must remain.
