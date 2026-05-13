#!/usr/bin/env bash
# Builds the MVP Affiliate WordPress plugin zip and places it in public/.
#
# Run this whenever wp-plugin/mvp-affiliate/* changes:
#   bash scripts/build-wp-plugin.sh
#
# The zip is then served as a static download from /mvp-affiliate.zip.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/wp-plugin/mvp-affiliate"
OUT="$ROOT/public/mvp-affiliate.zip"

if [ ! -d "$SRC" ]; then
  echo "Plugin source not found: $SRC" >&2
  exit 1
fi

# Strip any old build
rm -f "$OUT"

# Zip from the parent of the plugin folder so the archive contains
# `mvp-affiliate/mvp-affiliate.php` (WordPress requires the top-level folder).
cd "$(dirname "$SRC")"
zip -qr "$OUT" "$(basename "$SRC")" -x "*.DS_Store"

echo "Built: $OUT"
ls -lh "$OUT"
