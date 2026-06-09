// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Smoke test for thumbnail headline rendering.
//
// Why this exists: the thumbnail text-overflow bug bit us twice on
// 2026-06-08 (commits 63a569e and d939026). Each time, the regression
// was the same shape — someone tweaked a constant (column width, font
// ceiling, glyph ratio, MIN_FONT_PX floor) without re-checking that
// real-world long headlines still fit. The bug only surfaced when a
// user saw a cropped thumbnail in production.
//
// This script bakes a fixed set of known-pathological headlines through
// the real bakeSimpleHeadline() pipeline (opentype → Resvg → PNG) and
// asserts each one:
//   - Renders via the opentype path (not the Satori fallback).
//   - Does NOT emit an opentypeError containing "overflows".
//   - Produces a PNG > 50 KB (sanity check: text actually rendered).
//
// Run: `npm run test:thumbnails`
//
// Add a new case here whenever you ship a thumbnail whose headline looks
// pathological in production — that's the regression-prevention loop.

import { bakeSimpleHeadline } from '../lib/thumbnail-simple-bake'
import sharp from 'sharp'

interface TestCase {
  name: string
  copy: { line1: string; line2: string; emphasisWord: string }
}

// Curated set covering the failure modes we've actually hit:
//   - Short, easy case (sanity baseline)
//   - 17-char line that overflowed at the old 60% font-size floor (d939026)
//   - 20-char "BUY SINGLE GIFTS AGAIN" that bled into the face area (63a569e)
//   - Different emphasis-word positions (first word, mid-word, last word)
//   - Very long line that would force the 50px floor
const CASES: TestCase[] = [
  {
    name: 'short headline',
    copy: { line1: 'BUY THIS', line2: 'NOT THAT', emphasisWord: 'BUY' },
  },
  {
    name: '17-char line (d939026 regression)',
    copy: { line1: 'NEVER CHEAP AGAIN', line2: 'BULK GIFTS LEVELED UP', emphasisWord: 'NEVER' },
  },
  {
    name: '20-char wrap (63a569e regression)',
    copy: { line1: 'NEVER BUY SINGLE', line2: 'GIFTS AGAIN', emphasisWord: 'NEVER' },
  },
  {
    name: 'mid-line emphasis word',
    copy: { line1: 'NEVER SLEEP', line2: 'ON DIRTY AGAIN', emphasisWord: 'DIRTY' },
  },
  {
    name: 'long edge case',
    copy: { line1: 'STOP WASTING MONEY ON THIS', line2: 'WAY BETTER OPTION', emphasisWord: 'STOP' },
  },
]

async function main(): Promise<void> {
  console.log('Thumbnail headline smoke test')
  console.log(`Running ${CASES.length} bake cases at 1280×720...\n`)

  // A 1280x720 transparent PNG as the base layer. The bake composites
  // text + neon border on top — for this test we don't care about the
  // base image content, only whether the text renders within bounds.
  const base = await sharp({
    create: {
      width: 1280,
      height: 720,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer()

  let passed = 0
  const failures: Array<{ name: string; reasons: string[] }> = []

  for (const c of CASES) {
    process.stdout.write(`  ${c.name.padEnd(45)}`)
    const start = performance.now()
    const result = await bakeSimpleHeadline(base, c.copy)
    const ms = Math.round(performance.now() - start)

    const reasons: string[] = []
    if (result.png.byteLength < 50_000) {
      reasons.push(`PNG too small (${result.png.byteLength}B — text probably didn't render)`)
    }
    if (result.bakePath !== 'opentype') {
      reasons.push(`fell back to ${result.bakePath ?? 'none'} (opentype failed: ${result.opentypeError ?? 'unknown'})`)
    }
    if (result.opentypeError && result.opentypeError.toLowerCase().includes('overflow')) {
      reasons.push(`overflow detected: ${result.opentypeError}`)
    }
    if (result.renderError) {
      reasons.push(`renderError: ${result.renderError}`)
    }

    if (reasons.length === 0) {
      console.log(`  ✓  ${result.bakePath}  ${Math.round(result.png.byteLength / 1024)} KB  ${ms}ms`)
      passed++
    } else {
      console.log(`  ✗  ${ms}ms`)
      failures.push({ name: c.name, reasons })
    }
  }

  console.log(`\n${passed}/${CASES.length} passed`)

  if (failures.length > 0) {
    console.log('\nFailures:')
    for (const f of failures) {
      console.log(`  ${f.name}:`)
      for (const r of f.reasons) console.log(`    - ${r}`)
    }
    process.exit(1)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('\nTest runner crashed:', err instanceof Error ? err.message : err)
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exit(1)
})
