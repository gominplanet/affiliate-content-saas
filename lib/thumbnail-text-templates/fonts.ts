// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Font loader for the designer-grade thumbnail text overlay system.
// Loads display fonts from the @fontsource packages bundled in node_modules,
// caches the buffers in-process so we read each .woff once per warm Lambda.
//
// Why bundled fonts (not CDN fetch):
//   - Vercel cold-start latency would balloon if every render fetched fonts
//   - System fonts on the Linux runtime don't include Anton/Bangers/Bebas
//   - Satori needs explicit Buffer input — fetching at request time + parsing
//     would add 200-500ms to every thumbnail render. Bundling: ~5ms (warm).

import { readFileSync } from 'node:fs'
import path from 'node:path'

/** The display fonts we ship. Each one matches a specific design aesthetic
 *  on the templates that consume them. Add new entries here when a new
 *  template needs a font that isn't already loaded. */
export type FontFamily =
  | 'Anton'                // tall condensed sans — "WORTH IT?" / "BIG CURLS"
  | 'BebasNeue'            // tall condensed sans (alt) — alternative to Anton
  | 'Bangers'              // comic-book display — "FINALLY, PERFECT!!"
  | 'PermanentMarker'      // handwritten brush marker — accents + highlights
  | 'SigmarOne'            // heavy blocky display — "ULTIMATE" / banner pills
  | 'RussoOne'             // bold geometric — clean modern look

interface FontEntry {
  name: string
  data: Buffer
  weight: 400 | 700
  style: 'normal' | 'italic'
}

const FONT_FILES: Record<FontFamily, string> = {
  Anton: '@fontsource/anton/files/anton-latin-400-normal.woff',
  BebasNeue: '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff',
  Bangers: '@fontsource/bangers/files/bangers-latin-400-normal.woff',
  PermanentMarker: '@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff',
  SigmarOne: '@fontsource/sigmar-one/files/sigmar-one-latin-400-normal.woff',
  RussoOne: '@fontsource/russo-one/files/russo-one-latin-400-normal.woff',
}

/** Lazy-loaded font buffer cache. Survives across warm Lambda invocations. */
const fontCache = new Map<FontFamily, Buffer>()

function loadFont(family: FontFamily): Buffer {
  const cached = fontCache.get(family)
  if (cached) return cached
  // Resolve via require.resolve so it works whether we're in node_modules
  // at the repo root or hoisted to a workspace root.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const resolved = require.resolve(FONT_FILES[family])
  const buf = readFileSync(resolved)
  fontCache.set(family, buf)
  return buf
}

/**
 * Resolve the set of fonts a template needs into Satori's expected shape.
 * Pass the array returned here to Satori's `fonts` option.
 */
export function fontsFor(families: FontFamily[]): Array<{ name: string; data: Buffer; weight: 400; style: 'normal' }> {
  // Dedupe so a template asking for the same font twice doesn't load it twice.
  const unique = Array.from(new Set(families))
  return unique.map(family => ({
    name: family,
    data: loadFont(family),
    weight: 400 as const,
    style: 'normal' as const,
  }))
}

/** For diagnostics / admin pages — return which fonts are currently loaded. */
export function loadedFonts(): FontFamily[] {
  return Array.from(fontCache.keys())
}
