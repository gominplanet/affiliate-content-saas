// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One list of Amazon's ASIN-bearing paths, not twenty.
//
// A geni.us link resolved through https://www.amazon.com/clp/<ASIN>, the parser
// did not know /clp/, and it read null. The parser was fixed on 9 September at
// 14:41. A post generated at 15:18, THIRTY-SEVEN MINUTES LATER, still shipped a
// raw untagged Amazon link, because the code that built it carried its own
// `(dp|gp\/product)` regex and never called the parser. Nineteen other places
// carried the same copy: blog generation in four spots, the affiliate-link
// fixer, the share-url builder, Launchpad, Storefront Sync, Instagram images.
//
// The creator's post therefore linked to
// amazon.com/clp/B0FXY82HKF?ascsubtag=... with no tag= at all, which earns
// nothing. Fixing the parser was necessary and did nothing on its own.
//
// So this suite guards the thing that actually failed: not whether the parser
// knows /clp/ (test-asin-parsing covers that), but whether anyone has quietly
// grown a private copy of the path list again.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  ASIN_PATH_SEGMENTS, asinPathRegex, amazonProductUrlRegex,
  isAmazonProductUrl, asinFromAmazonUrl,
} from '../lib/asin'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the shared helpers agree with each other ────────────────────────────────
{
  check('/clp/ is in the one list', ASIN_PATH_SEGMENTS.includes('clp'), ASIN_PATH_SEGMENTS)

  const clp = 'https://www.amazon.com/clp/B0FXY82HKF?ascsubtag=9R5DTtCXiPA'
  check('the parser reads a /clp/ url', asinFromAmazonUrl(clp) === 'B0FXY82HKF')
  check('the predicate accepts a /clp/ url', isAmazonProductUrl(clp), 'this is the exact link that shipped untagged')
  check('the path regex matches /clp/', asinPathRegex('i').test(new URL(clp).pathname))
  check('the url regex matches /clp/', amazonProductUrlRegex('i').test(clp))

  // Every classic path still works.
  for (const p of ['dp', 'gp/product', 'gp/aw/d', 'product', 'clp']) {
    const u = `https://www.amazon.com/${p}/B0FXY82HKF`
    check(`/${p}/ parses`, asinFromAmazonUrl(u) === 'B0FXY82HKF', u)
    check(`/${p}/ is a product url`, isAmazonProductUrl(u), u)
  }

  // Things that are NOT products must stay out, or a search page becomes a buy
  // link.
  check('a search page is not a product', !isAmazonProductUrl('https://www.amazon.com/s?k=air+fryer'))
  check('a storefront is not a product', !isAmazonProductUrl('https://www.amazon.com/shop/someone'))
  check('another host is not a product', !isAmazonProductUrl('https://notamazon.com/dp/B0FXY82HKF'))
  check('a relative path is not a product', !isAmazonProductUrl('/dp/B0FXY82HKF'))

  // A fresh regex per call. A shared /g/ instance carries lastIndex between
  // uses, which makes every other call fail for no visible reason.
  const a = amazonProductUrlRegex('g'), b = amazonProductUrlRegex('g')
  a.test('https://www.amazon.com/dp/B0FXY82HKF')
  check('regexes are not shared instances', a !== b && b.lastIndex === 0)
}

// ── nobody has grown a private copy ─────────────────────────────────────────
{
  // The pattern that caused this: a path alternation written out by hand rather
  // than derived from ASIN_PATH_SEGMENTS.
  const HANDROLLED = /dp\|gp\\?\/product/
  const ROOTS = ['app', 'lib', 'services', 'components']
  const ALLOWED = new Set(['lib/asin.ts'])

  const offenders: string[] = []
  const walk = (dir: string) => {
    let entries: string[] = []
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
      const full = join(dir, e)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) { walk(full); continue }
      if (!/\.(ts|tsx)$/.test(e)) continue
      const rel = full.replace(/\\/g, '/')
      if (ALLOWED.has(rel)) continue
      let src = ''
      try { src = readFileSync(full, 'utf8') } catch { continue }
      src.split('\n').forEach((line, i) => {
        if (HANDROLLED.test(line)) offenders.push(`${rel}:${i + 1}`)
      })
    }
  }
  for (const r of ROOTS) walk(r)

  check('no hand-rolled ASIN path list outside lib/asin.ts',
    offenders.length === 0,
    offenders.length
      ? `${offenders.length} copy/copies at ${offenders.slice(0, 8).join(', ')}${offenders.length > 8 ? ' …' : ''}. Import from lib/asin instead: asinFromAmazonUrl, isAmazonProductUrl, asinPathRegex or amazonProductUrlRegex.`
      : undefined)

  // The scan has to actually be capable of finding something, or it passes
  // forever by looking in the wrong place.
  check('the scanner reads real files', HANDROLLED.test('/(?:dp|gp\\/product)/([A-Z0-9]{10})'),
    'if this fails the detector is broken and the check above proves nothing')
}

if (failures.length) {
  console.error(`\n❌ asin-single-source: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ asin-single-source: one path list, every caller derives from it, no private copies')
