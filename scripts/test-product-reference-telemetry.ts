// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Why a blog image had nothing real to copy.
//
// The share of body images generated with NO product reference went from 5% in
// July to 33% in September. That path is the highest-risk image path in the
// product: with no reference there is no ground truth for what the item looks
// like, so the model draws a plausible wrong product. The code's own comment
// says so and names a published article it ruined.
//
// It could not be diagnosed, because every distinct cause collapsed into one
// null. A body image falls through to text-only only when BOTH legs fail:
//
//   the product reference   uploaded photo → Amazon ASIN → Amazon page →
//                           non-Amazon page → campaign ASIN → nothing
//   the video frames        YouTube storyboard frames, which a post with no
//                           youtube_video_id (upload-first Launchpad, campaign
//                           posts, from-link posts) never has at all
//
// resolveProductReference has returned a `source` naming the winning leg since
// it was written, with a comment saying the field exists so we can "see how
// often each path is winning". Nothing read it. So a regression in the Amazon
// scrape and a shift in product mix toward upload-first videos produce exactly
// the same symptom, and neither can be told from the other.
//
// Both legs now leave a countable row. The rows cost nothing (images:0) and
// carry no content — they are one categorical fact each.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const ROUTE = readFileSync('app/api/blog/generate/route.ts', 'utf8')
const RESOLVER = readFileSync('lib/resolve-product-reference.ts', 'utf8')

// ── the resolver still reports which leg won ────────────────────────────────
//
// The whole diagnosis rests on this union. If a leg is added or renamed there
// and the route is not updated, the new leg silently records under a feature
// name nobody queries.
{
  // Comments in this file mention source: 'none' too, so match only a real
  // union (at least one pipe) and ignore comment lines outright.
  const decl = RESOLVER.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const union = decl.match(/source: ('[a-z-]+'(?:\s*\|\s*'[a-z-]+')+)/)?.[1] ?? ''
  const legs = [...union.matchAll(/'([a-z-]+)'/g)].map(m => m[1])
  check('the resolver names the winning leg', legs.length >= 6,
    `found ${legs.length}: ${legs.join(', ')}`)
  for (const leg of ['uploaded', 'amazon-asin', 'amazon-page-url', 'non-amazon-page', 'campaign-asin', 'none']) {
    check(`'${leg}' is still a leg the resolver can report`, legs.includes(leg),
      'if this was renamed, the recorded feature name changed with it and the old query goes quiet rather than failing')
  }
}

// ── the route records it instead of throwing it away ────────────────────────
{
  check('the winning leg is recorded',
    /feature: `blog_product_ref_\$\{leg\}`/.test(ROUTE),
    'the source field existed for exactly this and was never read')

  check('a resolved-then-lost photo is its own outcome',
    /ref\.productImageUrl \? 'upload-failed' : 'none'/.test(ROUTE),
    'finding no photo and finding one we then failed to download are different bugs with different fixes; as one null they were the same bug')

  check('the leg reflects what actually reached the image model',
    /const leg = falProductImageUrl\s*\n?\s*\? ref\.source/.test(ROUTE),
    'recording ref.source when the upload failed would report a reference the render never got — the plan, not the artifact')

  check('the frame leg is recorded too',
    /blog_body_frames_ok/.test(ROUTE) && /blog_body_frames_none/.test(ROUTE),
    'text-only needs BOTH legs to fail, so one leg alone cannot explain the rate')
}

// ── the diagnosis costs nothing ─────────────────────────────────────────────
//
// These rows exist to be counted, not billed. An images:1 here would invent
// spend and eat the creator's monthly ceiling for a log line.
{
  const diagBlocks = [...ROUTE.matchAll(/feature: [^,]*blog_(?:product_ref|body_frames)[^,]*,[\s\S]{0,80}?model: 'diagnostic', images: (\d+)/g)]
  check('every diagnostic row is free', diagBlocks.length >= 2 && diagBlocks.every(m => m[1] === '0'),
    `${diagBlocks.length} diagnostic rows, images values: ${diagBlocks.map(m => m[1]).join(', ')}`)
}

// ── and it records a category, never a URL ──────────────────────────────────
//
// ai_usage is a cost table read by dashboards, not a place for customer
// content. A product URL or title in a feature name would put scraped
// merchant data somewhere nobody expects to find it.
{
  check('the recorded value is a fixed category',
    !/feature: `blog_product_ref_\$\{(?:ref\.productImageUrl|ref\.productTitle|productTitleForPrompts)/.test(ROUTE),
    'a URL or a product name in a feature name is customer content in a cost table')
}

if (failures.length) {
  console.error(`\n❌ product-reference-telemetry: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ product-reference-telemetry: both legs say which one failed, a lost download is distinct from a missing photo, and asking costs nothing')
