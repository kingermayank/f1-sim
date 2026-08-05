#!/usr/bin/env bash
# Produces web-ready runtime GLBs for each supplied team car.
#
# Source cars are 14-60 MB Sketchfab exports with 2-4K textures. Each team model
# is loaded once at runtime and cloned for its two drivers, so the budget here is
# per-team, not per-car.
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
    --texture-size 1024 \
    2>&1 | grep -E "→|error" || true
}

optimize_car red-bull     "red-bull/original/source/extracted/F1-2025 Redbull RB21.glb"
optimize_car ferrari      "ferrari/original/source/ferrari_sf-25.glb"
optimize_car mclaren      "mclaren/original/source/f1-2025_mclaren_mcl39.glb"
optimize_car aston-martin "aston-martin/original/source/Aston Martin Aramco AMR25.glb"
optimize_car alpine       "alpine/original/source/f1-2025_alpine_a525.glb"
optimize_car williams     "williams/original/source/extracted/Untitled.gltf"
optimize_car racing-bulls "racing-bulls/original/source/extracted/untitled.gltf"

echo "=== RESULTS ==="
ls -lh "$OUT"
