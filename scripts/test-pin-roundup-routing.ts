// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A post about four things must not get a pin about one thing.
//
// A Deal Radar roundup, "I tested 4 home deals at their lowest Amazon prices
// this week", came back as a pin for a single beverage fridge: that one
// product's callouts down the side, and a review question across the top,
// "DOES IT KEEP 130 CANS ICE COLD?". Three of the four deals were nowhere.
//
// The cause was one list. The multi-product path is chosen by post_type, and
// the list read ['guide', 'comparison']. A Deal Radar roundup is written as
// post_type 'deal', so it never matched, and every deals roundup MVP has ever
// made took the single-product review path.
//
// Worth noting what the list did contain: 'comparison', which nothing in the
// codebase writes. So the check accepted a type that never occurs and rejected
// the one that matters. That is the shape of this bug, and it is why the test
// below asserts against the post types actually WRITTEN by the app rather than
// against a list someone maintains by hand.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const PIN_ASSETS = readFileSync(join(root, 'lib/pin-assets.ts'), 'utf8')
const ART_DIRECTOR = readFileSync(join(root, 'lib/art-director-pin.ts'), 'utf8')

/** Every post_type the app actually writes, read from the source rather than
 *  from a list kept in step by hand. A new one appearing here that the pin
 *  router does not know about is exactly how this bug happened. */
function writtenPostTypes(): Set<string> {
  const found = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry)) {
        for (const m of readFileSync(full, 'utf8').matchAll(/post_type:\s*'([a-z_]+)'/g)) found.add(m[1])
      }
    }
  }
  for (const d of ['app', 'lib']) walk(join(root, d))
  return found
}

// ── the routing list ────────────────────────────────────────────────────────
{
  const m = PIN_ASSETS.match(/const isRoundup = \[([^\]]+)\]/)
  check('the roundup list is findable', !!m, 'the pin router changed shape')
  const list = (m?.[1] || '').match(/'([a-z_]+)'/g)?.map(s => s.replace(/'/g, '')) || []

  check('a Deal Radar roundup counts as a roundup', list.includes('deal'),
    'post_type "deal" is what a multi-deal roundup is written as; without it every one takes the single-product path')
  check('a buying guide still counts', list.includes('guide'))

  // The types the app writes that are NOT multi-product, so they must stay out.
  for (const single of ['review', 'article']) {
    check(`${single} is not treated as a roundup`, !list.includes(single),
      'a single review must keep the single-product design')
  }

  // The real guard: every post type the app writes is either in this list on
  // purpose or out of it on purpose. A new one belongs to somebody's decision.
  const known = new Set([...list, 'review', 'article'])
  for (const t of writtenPostTypes()) {
    check(`post_type '${t}' has been considered by the pin router`, known.has(t),
      'a post type the app writes but the pin router has never heard of will silently take the single-product path, which is exactly what happened to deals')
  }
}

// ── the gate reads the post, not a guess about it ───────────────────────────
// Fixing the post-type list was not enough. The gate ALSO required an AI field,
// collage_products, which the copy step fills in from the title and excerpt. On
// the same four-deal roundup it came back with fewer than two, so the door
// stayed shut and the pin was a single-product review again.
//
// The post is not ambiguous: it carries an affiliate link per product, and the
// block immediately after the gate already reads them to resolve real photos.
// That evidence was sitting one step behind the gate that needed it.
{
  check('the post\'s own product links can open the gate',
    /bodyProductLinks/.test(PIN_ASSETS),
    'the links in the body are the evidence; the AI list is a guess about it')
  check('and either signal is enough',
    /collageProducts\.length >= 2 \|\| bodyProductLinks >= 2/.test(PIN_ASSETS),
    'the AI list stays as a second way in, not the only one')
  check('two products are still required either way',
    />= 2/.test(PIN_ASSETS),
    'a single-deal post must not be designed as a collage of one')
  check('the link count is only computed for a roundup',
    /isRoundup\s*\n?\s*\? allProductUrls/.test(PIN_ASSETS),
    'a single review must not pay to be told it is a single review')
  check('and it reads stored content rather than fetching the page',
    /allProductUrls\(String\(p\.content/.test(PIN_ASSETS),
    'this runs for every pin; a network fetch here would cost every single review a page load')
}

// ── a deals roundup does not look like a buying guide ───────────────────────
// They are different posts. On a deals pin the news is the price; numbered
// badges imply a ranking that a set of simultaneous price drops does not have.
{
  check('the collage designer is told which kind it is', /kind\?: 'deal' \| 'guide'/.test(ART_DIRECTOR))
  check('and the caller tells it', /kind: roundupKind/.test(PIN_ASSETS))
  check('a deal roundup gets its own format line', /ROUNDUP OF \$\{n\} CURRENT PRICE DROPS/.test(ART_DIRECTOR))
  check('it reads as a deals board rather than a review',
    /DEALS board, not a review/.test(ART_DIRECTOR))
  check('and drops the ranking badges',
    /No numbered ranking badges/.test(ART_DIRECTOR),
    'simultaneous price drops are not a countdown')
  check('the buying guide keeps its numbered picks',
    /small round number badge/.test(ART_DIRECTOR),
    'on a guide the order means something and should stay')
}

// ── and it still refuses to invent a person ─────────────────────────────────
{
  check('the roundup prompt keeps the no-people rule',
    /ABSOLUTELY NO PEOPLE/.test(ART_DIRECTOR))
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
