#!/usr/bin/env bash
# Package the Chrome Web Store UPLOAD build → public/mvp-cc-scout-store.zip.
#
# Same source as the sideload build (scripts/zip-extension.sh) but with the two
# things CWS requires that the load-unpacked build can't have:
#   1. NO `key` field in manifest.json — CWS assigns the id and REJECTS an
#      uploaded key. (The sideload build KEEPS the key so existing load-unpacked
#      installs stay on their pinned id.)
#   2. `description` ≤ 132 chars (CWS listing summary limit).
# It also strips the private signing material and the high-res icon sources, and
# fails loudly if any of that leaks into the zip.
#
# Runs from `npm run build:extension` so the committed store zip never drifts
# behind the extension source (that drift is exactly what shipped the old icon).
# No-ops gracefully if `zip` isn't on the build image — the committed zip stands.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/mvp-cc-scout-store.zip"

if ! command -v zip >/dev/null 2>&1; then
  echo "[zip-extension-store] 'zip' not found — keeping committed public/mvp-cc-scout-store.zip"
  exit 0
fi

# Assemble a clean copy so we can strip the key without touching the source.
TMP="$ROOT/.scout-store-build"
rm -rf "$TMP"; mkdir -p "$TMP"
cp -R "$ROOT/extension/." "$TMP/"
# Drop signing material, icon sources, and junk from the copy.
rm -f "$TMP/key.pem" "$TMP"/*.pem "$TMP/.keyinfo.txt" "$TMP/.gitignore"
rm -f "$TMP"/icons/source-*.png
find "$TMP" -name '.DS_Store' -delete 2>/dev/null || true

# Strip the `key` field from the manifest (node is always present in a Next build).
node -e "const fs=require('fs');const p='$TMP/manifest.json';const m=JSON.parse(fs.readFileSync(p,'utf8'));delete m.key;if((m.description||'').length>132){console.error('[zip-extension-store] FATAL: description >132 chars ('+m.description.length+')');process.exit(1)}fs.writeFileSync(p,JSON.stringify(m,null,2)+'\n')"

cd "$TMP"
rm -f "$OUT"
zip -r -X "$OUT" . -x '*.DS_Store' '__MACOSX/*' '*/.*' '.git*' >/dev/null

# Belt-and-suspenders: never ship signing material, key, or icon sources.
if unzip -l "$OUT" | grep -Eiq '\.pem|keyinfo|source-'; then
  echo "[zip-extension-store] FATAL: signing material / icon source leaked into $OUT — aborting" >&2
  rm -f "$OUT"; cd "$ROOT"; rm -rf "$TMP"; exit 1
fi
if node -e "const m=require('$TMP/manifest.json');process.exit('key' in m?1:0)"; then :; else
  echo "[zip-extension-store] FATAL: 'key' still present in store manifest — aborting" >&2
  rm -f "$OUT"; cd "$ROOT"; rm -rf "$TMP"; exit 1
fi

cd "$ROOT"; rm -rf "$TMP"
echo "[zip-extension-store] packaged store build → public/mvp-cc-scout-store.zip"
