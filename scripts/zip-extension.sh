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
# CRITICAL: never ship the signing material — key.pem is the PRIVATE key that
# pins the extension ID, and .keyinfo.txt documents it. They live in extension/
# (gitignored) only so the maintainer can re-pack a signed build; packaging them
# into the PUBLIC download would hand anyone the key to impersonate the
# extension. `*/.*` only catches subdir dotfiles, so top-level dotfiles
# (.keyinfo.txt, .gitignore) must be excluded explicitly.
zip -r -X "$OUT" . \
  -x '*.DS_Store' '__MACOSX/*' '*/.*' \
     'key.pem' '*.pem' '.keyinfo.txt' '.git*' >/dev/null
# Belt-and-suspenders: fail loudly if any signing material slipped into the zip.
if unzip -l "$OUT" | grep -Eiq '\.pem|keyinfo'; then
  echo "[zip-extension] FATAL: signing material leaked into $OUT — aborting" >&2
  rm -f "$OUT"
  exit 1
fi
echo "[zip-extension] packaged extension → public/mvp-cc-scout.zip"
