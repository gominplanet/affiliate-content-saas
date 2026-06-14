#!/usr/bin/env bash
# Package the Scout / Co-Pilot extension into public/ as a sideload download.
# Wired into `npm run build` so the downloadable zip never goes stale against
# the extension source (the May-2026 zip drifted ~3 versions behind before this).
# No-ops gracefully if `zip` isn't on the build image (the committed zip stands).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/mvp-cc-scout.zip"

if ! command -v zip >/dev/null 2>&1; then
  echo "[zip-extension] 'zip' not found — keeping committed public/mvp-cc-scout.zip"
  exit 0
fi

cd "$ROOT/extension"
rm -f "$OUT"
# -X drops extra file attributes; exclude OS/editor junk so the package is clean.
zip -r -X "$OUT" . -x '*.DS_Store' '__MACOSX/*' '*/.*' >/dev/null
echo "[zip-extension] packaged extension → public/mvp-cc-scout.zip"
