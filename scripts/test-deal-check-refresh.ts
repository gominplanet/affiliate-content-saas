// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "This is the lowest price we've tracked" has to stop being true on its own.
//
// Reported on a live post: the price was refreshed from Deal Radar, the
// sentences in the article were corrected, and the green Deal check block still
// read "This is the lowest price we've tracked" with the marker pinned at the
// all-time low, which Keepa no longer supported.
//
// The refresh runs ONE Haiku pass whose prompt says "Keep ALL HTML tags,
// attributes, links, images, and shortcodes EXACTLY as-is". The Deal check is
// not prose, it is a deterministic block, so the model correctly left it alone.
// The block WAS rebuilt, but only inside the `if (!looksOk)` fallback: refreshed
// when the rewrite failed, skipped when it worked. Exactly backwards.
//
// The swap is tested against REAL buildPriceSnapshotHtml output rather than a
// hand-written fixture, because the block has TWO SHAPES and that turned out to
// matter more than expected. Measured against the regex this replaced:
//
//   with the position bar     captured the block exactly
//   without the position bar  matched nothing at all
//
// So on a product with a percentage but no all-time low, the old fallback found
// no block, left the content identical, and the refresh answered 422
// "Couldn't safely rewrite the post automatically". The first version of the
// bar-less fixture below set both price bounds, rendered a bar, and tested the
// same shape twice — so it passed against the broken regex.
import { readFileSync } from 'node:fs'
import { buildPriceSnapshotHtml } from '../services/keepa'
import { findPriceSnapshotBlock, replacePriceSnapshot } from '../lib/price-snapshot-swap'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// Two real assessments: one at the all-time low (the strongest verdict, and the
// one that was going stale), one merely below average.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const atLow: any = { currentCents: 6999, avg90Cents: 12999, allTimeLowCents: 6999, pctBelowAvg90: 46, quality: 'excellent' }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// NO BAR: the bar needs current + all-time low + typical, so leaving the low
// out is what produces the second shape. The first version of this fixture set
// both bounds, rendered a bar, and so tested the same shape twice — which is
// why it passed against the old regex that could not match a bar-less block at
// all.
const mild: any = { currentCents: 11999, avg90Cents: 12999, allTimeLowCents: null, pctBelowAvg90: 8, quality: 'genuine' }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nothing: any = { currentCents: 12999, avg90Cents: null, allTimeLowCents: null, pctBelowAvg90: null, quality: null }

const LOW_HTML = buildPriceSnapshotHtml(atLow)
const MILD_HTML = buildPriceSnapshotHtml(mild)

// ── the fixtures are the real thing ─────────────────────────────────────────
{
  check('the all-time-low block renders', LOW_HTML.length > 100)
  check('and carries the claim that goes stale', /lowest price we/i.test(LOW_HTML), LOW_HTML.slice(0, 120))
  check('and the position bar', /All-time low/.test(LOW_HTML),
    'one of the two shapes; the other has no bar and is the one the old regex could not match')
  check('the milder block says something different', /below its usual|Well below/i.test(MILD_HTML), MILD_HTML.slice(0, 160))
  check('and the second fixture really has NO bar', !/All-time low/.test(MILD_HTML),
    'otherwise both fixtures are the same shape and the bar-less case is never tested')
  check('no usable history renders nothing at all', buildPriceSnapshotHtml(nothing) === '',
    'which is how the block gets REMOVED rather than left saying something untrue')
}

const POST = (block: string) => `<p>Intro paragraph about the thing.</p>
<h2>The deal at a glance</h2>
<p>It is a good price right now.</p>
${block}
<div class="wp-block-group"><p>After the block.</p></div>
[mvp_deal_cta url="https://example.com"]
<p>Closing paragraph.</p>`

// ── the block is found, whole, in both shapes ───────────────────────────────
{
  for (const [name, block] of [['with a bar', LOW_HTML], ['without a bar', MILD_HTML]] as const) {
    const html = POST(block)
    const found = findPriceSnapshotBlock(html)
    check(`found ${name}`, !!found)
    if (!found) continue
    const cut = html.slice(found.start, found.end)
    check(`the whole block is captured ${name}`, cut === block,
      `captured ${cut.length} of ${block.length} chars — a short capture leaves orphan </div>s in the published post`)
    check(`nothing after it is swallowed ${name}`, !cut.includes('wp-block-group'),
      'a greedy match would eat the rest of the article')
    check(`the shortcode survives ${name}`, html.slice(found.end).includes('[mvp_deal_cta'))
  }
}

// ── the swap actually swaps ─────────────────────────────────────────────────
{
  const stale = POST(LOW_HTML)
  const out = replacePriceSnapshot(stale, MILD_HTML)
  check('a refresh replaces the block', out.replaced && out.reason === 'ok')
  check('THE STALE CLAIM IS GONE', !/lowest price we/i.test(out.html),
    'this is the whole bug: the article’s sentences were corrected and this line was not')
  check('the new verdict is in', /below its usual|Well below/i.test(out.html))
  check('the rest of the post is untouched',
    out.html.includes('[mvp_deal_cta url="https://example.com"]')
    && out.html.includes('wp-block-group')
    && out.html.includes('<h2>The deal at a glance</h2>'))
  check('exactly one block remains',
    (out.html.match(/mvp-price-snapshot/g) || []).length === 1,
    'a failed splice can leave the old block sitting next to the new one')
}

// ── no honest verdict left means the block is REMOVED ───────────────────────
{
  const stale = POST(LOW_HTML)
  const out = replacePriceSnapshot(stale, buildPriceSnapshotHtml(nothing))
  check('the block is removed', out.replaced && out.reason === 'nothing-to-say')
  check('and nothing claims anything', !/mvp-price-snapshot|lowest price we/i.test(out.html),
    'a stale verdict is worse than no deal check')
  check('the article still stands', out.html.includes('[mvp_deal_cta') && out.html.includes('<h2>'))
}

// ── a post with no block is a normal state, not an error ────────────────────
{
  const plain = '<p>A deal post written when there was no usable price history.</p>'
  const out = replacePriceSnapshot(plain, LOW_HTML)
  check('no block is reported, not invented', !out.replaced && out.reason === 'no-block')
  check('and the post is returned unchanged', out.html === plain)
}

// ── unbalanced markup is refused rather than guessed at ─────────────────────
{
  const broken = `<p>x</p><div class="mvp-price-snapshot"><div>Deal check</div>`
  check('an unclosed block finds no end', findPriceSnapshotBlock(broken) === null,
    'cutting at a guess would publish an article sliced in half')
  const out = replacePriceSnapshot(broken, MILD_HTML)
  check('and the post is left alone', !out.replaced && out.html === broken)
}

// ── the route refreshes it on the SUCCESS path, not only on failure ─────────
{
  const SRC = readFileSync('app/api/deals/refresh-price/route.ts', 'utf8')
  const fallbackAt = SRC.indexOf('if (!looksOk)')
  const alwaysAt = SRC.indexOf('const freshSnapshot = buildPriceSnapshotHtml(a)')
  check('the route rebuilds the block unconditionally', alwaysAt > -1,
    'rebuilding it only inside the !looksOk fallback is the bug: refreshed when the rewrite failed, skipped when it worked')
  check('and does so AFTER the fallback', alwaysAt > fallbackAt,
    'so a mangled rewrite is repaired first and then gets a fresh block too')
  check('the shape-specific regex is gone', !/mvp-price-snapshot"\[\\s\\S\]/.test(SRC) && !SRC.includes('<\\/div>\\s*<\\/div>'),
    'it matched only the barred shape and 422\u2019d every bar-less post')
  check('the route reports what changed', /dealCheck:/.test(SRC),
    'a bare { ok: true } for a refresh that left the verdict stale is the failure this fix is about')
}

if (failures.length) {
  console.error(`\n❌ deal-check-refresh: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ deal-check-refresh: the Deal check block is rebuilt on every refresh, removed when no verdict is honest, and the swap is exact in both block shapes')
