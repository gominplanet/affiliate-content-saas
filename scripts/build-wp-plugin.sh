#!/usr/bin/env bash
# Builds the MVP Affiliate WordPress plugin AND theme zips into public/.
#
# Run this whenever wp-plugin/* changes:
#   bash scripts/build-wp-plugin.sh
#
# Outputs:
#   public/mvp-affiliate.zip        (plugin)
#   public/mvp-affiliate-theme.zip  (theme)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WP="$ROOT/wp-plugin"

build_zip() {
  local SRC="$1"
  local OUT="$2"
  if [ ! -d "$SRC" ]; then
    echo "Source not found: $SRC" >&2
    return 1
  fi
  rm -f "$OUT"
  cd "$(dirname "$SRC")"
  zip -qr "$OUT" "$(basename "$SRC")" -x "*.DS_Store" -x "__MACOSX*"
  echo "Built: $OUT"
  ls -lh "$OUT"
}

build_zip "$WP/mvp-affiliate"       "$ROOT/public/mvp-affiliate.zip"
build_zip "$WP/mvp-affiliate-theme" "$ROOT/public/mvp-affiliate-theme.zip"
