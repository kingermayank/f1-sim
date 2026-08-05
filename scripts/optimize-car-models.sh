#!/usr/bin/env bash
# Produces web-ready runtime GLBs for each supplied team car.
#
# Source cars are 14-60 MB Sketchfab exports with 2-4K textures. Each team model
# is loaded once at runtime and cloned for its two drivers, so the budget here is
# per-team, not per-car.
#
# Textures are capped at 512 px. Cars are seen at broadcast distance, and 1024 px
# maps across seven models cost enough decompressed VRAM to lose the WebGL
# context on modest GPUs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/work/assets-source/cars"
OUT="$ROOT/work/optimized/cars"
mkdir -p "$OUT"

optimize_car() {
  local team="$1"
  local input="$2"
  echo "=== $team ==="
  npx gltf-transform optimize "$SRC/$input" "$OUT/$team.glb" \
    --compress meshopt \
    --simplify true \
    --simplify-error 0.001 \
    --texture-compress webp \
    --texture-size 512 \
    2>&1 | grep -E "→|error" || true
}

optimize_car red-bull     "red-bull/original/source/extracted/F1-2025 Redbull RB21.glb"
optimize_car ferrari      "ferrari/original/source/ferrari_sf-25.glb"
optimize_car mclaren      "mclaren/original/source/f1-2025_mclaren_mcl39.glb"
optimize_car aston-martin "aston-martin/original/source/Aston Martin Aramco AMR25.glb"
optimize_car alpine       "alpine/original/source/f1-2025_alpine_a525.glb"
optimize_car williams     "williams/original/source/extracted/Untitled.gltf"
# The VCARB source is ~10x denser than the other cars (649k triangles) and the
# error-based simplifier barely touches it. Run the normal optimize pass first so
# the geometry is cleaned and indexed, then weld and decimate by ratio, then
# recompress. Simplifying the raw export directly does almost nothing.
echo "=== racing-bulls ==="
npx gltf-transform optimize "$SRC/racing-bulls/original/source/extracted/untitled.gltf" "$OUT/.rb-base.glb" \
  --compress meshopt --simplify true --simplify-error 0.001 --texture-compress webp --texture-size 512 >/dev/null 2>&1
npx gltf-transform weld "$OUT/.rb-base.glb" "$OUT/.rb-weld.glb" >/dev/null 2>&1
npx gltf-transform simplify "$OUT/.rb-weld.glb" "$OUT/.rb-simplified.glb" --ratio 0.12 --error 0.01 >/dev/null 2>&1
npx gltf-transform optimize "$OUT/.rb-simplified.glb" "$OUT/racing-bulls.glb" \
  --compress meshopt --simplify false --texture-compress webp --texture-size 512 \
  2>&1 | grep -E "→|error" || true
rm -f "$OUT/.rb-base.glb" "$OUT/.rb-weld.glb" "$OUT/.rb-simplified.glb"

echo "=== RESULTS ==="
ls -lh "$OUT"
