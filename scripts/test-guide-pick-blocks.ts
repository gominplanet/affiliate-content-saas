// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A buying guide that cannot be bought from.
//
// Guides are assembled from the creator's own reviews, and every click in one
// went to the review post. No video on the page, and no way to buy. A reader
// sold by section three had to click through to the review, find the button
// there, and click again, and the ones who were ready right then just left.
//
// Each section now carries the source video, a buy link and the review link. Two
// rules decide whether that is worth anything:
//
//   The links are built from data here, never written by the model. A model that
//   writes a URL can mistype one, drop one, or reuse one, and a wrong affiliate
//   link pays someone else while looking perfectly fine on the page.
//
//   What actually landed is reported. A guide with five sections and one buy
//   button is indistinguishable from a healthy one otherwise, which is how a
//   creator publishes twenty of them before noticing.
import {
  pickMediaHtml, pickCtaHtml, injectPickBlocks, describePickCoverage,
  mediaMarker, ctaMarker, type GuidePick,
} from '../lib/guide-pick-blocks'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// A plain function with a return, not `=> ({…})`. The arrow form is followed
// here by a bare `{` block, and with no semicolons TypeScript reads the object
// literal as an arrow PARAMETER list and fails to parse the whole file.
function pick(over: Partial<GuidePick> = {}): GuidePick {
  return {
    index: 1,
    name: 'Coolife 3 Piece Set',
    reviewUrl: 'https://gominreviews.com/coolife-3-piece-luggage-carry-on-set-review/',
    youtubeVideoId: 'abc12345678',
    thumbnailUrl: 'https://i.ytimg.com/vi/abc12345678/hqdefault.jpg',
    buyUrl: 'https://mvpl.ink/x7k',
    buyIsAmazon: true,
    ...over,
  }
}

// ── the video, playable where the reader already is ─────────────────────────
{
  const html = pickMediaHtml(pick())
  check('a pick with a video gets an embed', /wp:embed/.test(html))
  check('and the embed carries the watch url', /youtube\.com\/watch\?v=abc12345678/.test(html))
  check('and no raw iframe is emitted', !/<iframe/i.test(html),
    'WordPress strips iframes for any author without unfiltered_html, which is most of them')

  // No video is a real case: a pick read back from WordPress alone has no MVP
  // row behind it. The thumbnail linked to the review is the floor.
  const noVideo = pickMediaHtml(pick({ youtubeVideoId: null }))
  check('a pick with no video falls back to the thumbnail', /<img/.test(noVideo))
  check('and the thumbnail links to the review', /<a href="https:\/\/gominreviews\.com/.test(noVideo))
  check('and the image lazy-loads', /loading="lazy"/.test(noVideo),
    'seven eager images above the fold is a slow guide')

  check('a pick with neither emits nothing',
    pickMediaHtml(pick({ youtubeVideoId: null, thumbnailUrl: null })) === '')
}

// ── both ways out of a section ──────────────────────────────────────────────
{
  const cta = pickCtaHtml(pick())
  check('the buy link is there', /mvpl\.ink\/x7k/.test(cta))
  check('the review link is there too', /coolife-3-piece-luggage/.test(cta),
    'the decided reader and the undecided reader need different links')
  check('the buy link is nofollow sponsored', /rel="nofollow sponsored noopener"/.test(cta))
  check('and opens in a new tab', /target="_blank"/.test(cta))

  // Amazon's Associates policy 6(w): a placement must make clear it links to an
  // Amazon site. Nobody can tell that mvpl.ink/x7k goes to Amazon by looking at
  // it, so the words on the button are the only thing that makes it clear.
  check('an Amazon destination names Amazon on the button', /Check price on Amazon/.test(cta),
    'a cloaked link with a generic label is the exact 6(w) violation')
  const nonAmazon = pickCtaHtml(pick({ buyIsAmazon: false }))
  check('a non-Amazon destination does not claim Amazon', !/Amazon/.test(nonAmazon), nonAmazon)

  // Half a CTA row is still worth rendering.
  check('no buy link still renders the review link',
    /Read the full review/.test(pickCtaHtml(pick({ buyUrl: null }))))
  check('no review link still renders the buy link',
    /Check price/.test(pickCtaHtml(pick({ reviewUrl: null }))))
  check('neither renders nothing', pickCtaHtml(pick({ buyUrl: null, reviewUrl: null })) === '')

  // A product name with a quote in it must not break out of the alt attribute.
  const nasty = pickMediaHtml(pick({ youtubeVideoId: null, name: 'The "Best" Set <script>' }))
  check('a name with markup is escaped', !/<script>/.test(nasty), nasty)
  check('and quotes cannot close the attribute', !/alt="The "Best"/.test(nasty), nasty)
}

// ── placement by marker ─────────────────────────────────────────────────────
{
  const written = [
    '<p>Lead paragraph that answers the question.</p>',
    '<h2>Quick recap</h2><p>Recap.</p>',
    `<h2>1. Coolife Set, Best Overall</h2>${mediaMarker(1)}<p>Why it wins.</p>${ctaMarker(1)}`,
    `<h2>2. Samsonite Omni, Best Hard Shell</h2>${mediaMarker(2)}<p>Why it wins.</p>${ctaMarker(2)}`,
    '<h2>Frequently Asked Questions</h2><h3>Q</h3><p>A</p>',
  ].join('\n')

  const picks = [pick({ index: 1 }), pick({ index: 2, name: 'Samsonite Omni', buyUrl: 'https://mvpl.ink/zz9' })]
  const { html, report } = injectPickBlocks(written, picks)

  check('every marker is replaced', !/MVP_(MEDIA|CTA)_/.test(html), 'a leftover marker ships to the reader as an HTML comment')
  check('both sections got their video', report.withVideo === 2)
  check('both sections got their buy link', report.withBuyLink === 2)
  check('and it was the marker path', report.picks.every(p => p.media === 'marker' && p.cta === 'marker'))
  check('nothing went unplaced', report.unplaced === 0)

  // Each section's own links, in its own section. Crossing them would send the
  // reader to the wrong product with nothing looking wrong.
  const sec1 = html.slice(html.indexOf('1. Coolife'), html.indexOf('2. Samsonite'))
  const sec2 = html.slice(html.indexOf('2. Samsonite'), html.indexOf('Frequently Asked'))
  check('section one carries its own buy link', sec1.includes('mvpl.ink/x7k') && !sec1.includes('mvpl.ink/zz9'))
  check('section two carries its own buy link', sec2.includes('mvpl.ink/zz9') && !sec2.includes('mvpl.ink/x7k'))
}

// ── placement when the writer drops the markers ─────────────────────────────
//
// The model is instructed to emit them and usually will. "Usually" is not a
// plan, and the fallback must not put section two's video inside section one.
{
  const written = [
    '<p>Lead.</p>',
    '<h2>Quick recap</h2><p>Recap.</p>',
    '<h2>1. Coolife Set, Best Overall</h2><p>Why it wins.</p>',
    '<h2>2. Samsonite Omni, Best Hard Shell</h2><p>Why it wins.</p>',
    '<h2>Which one should you pick?</h2><p>Wrap.</p>',
  ].join('\n')

  const picks = [pick({ index: 1 }), pick({ index: 2, name: 'Samsonite Omni', buyUrl: 'https://mvpl.ink/zz9' })]
  const { html, report } = injectPickBlocks(written, picks)

  check('the fallback still places both videos', report.withVideo === 2, JSON.stringify(report.picks))
  check('the fallback still places both CTAs', report.withBuyLink === 2, JSON.stringify(report.picks))
  check('and it reports that it fell back to headings',
    report.picks.every(p => p.media === 'heading' && p.cta === 'heading'),
    'if every guide reports heading placement, the writer stopped emitting markers and somebody should know')

  const sec1 = html.slice(html.indexOf('1. Coolife'), html.indexOf('2. Samsonite'))
  const sec2 = html.slice(html.indexOf('2. Samsonite'), html.indexOf('Which one'))
  check('section one keeps its own links', sec1.includes('mvpl.ink/x7k') && !sec1.includes('mvpl.ink/zz9'), sec1)
  check('section two keeps its own links', sec2.includes('mvpl.ink/zz9') && !sec2.includes('mvpl.ink/x7k'), sec2)

  // The guide's own headings (Quick recap, the wrap-up) are H2s too. Counting
  // plain headings would have put pick one's video under "Quick recap".
  const recap = html.slice(html.indexOf('Quick recap'), html.indexOf('1. Coolife'))
  check('the guide\'s own headings are not mistaken for picks',
    !/wp:embed/.test(recap) && !/Check price/.test(recap), recap)

  // The last pick's CTA must land before the wrap-up heading, not after it.
  check('the last CTA stays inside its own section',
    html.indexOf('mvpl.ink/zz9') < html.indexOf('Which one should you pick?'))
}

// ── what the creator is told ────────────────────────────────────────────────
{
  const full = injectPickBlocks(
    `<h2>1. A</h2>${mediaMarker(1)}<p>x</p>${ctaMarker(1)}<h2>2. B</h2>${mediaMarker(2)}<p>x</p>${ctaMarker(2)}`,
    [pick({ index: 1 }), pick({ index: 2 })],
  ).report
  const msg = describePickCoverage(full)
  check('a healthy guide is described as complete', /all with a buy link/.test(msg), msg)

  // The case that matters: a pick whose review has no product link in it.
  const partial = injectPickBlocks(
    `<h2>1. A</h2>${mediaMarker(1)}<p>x</p>${ctaMarker(1)}<h2>2. B</h2>${mediaMarker(2)}<p>x</p>${ctaMarker(2)}`,
    [pick({ index: 1 }), pick({ index: 2, buyUrl: null })],
  ).report
  check('a missing buy link is counted', partial.withBuyLink === 1, JSON.stringify(partial))
  const pmsg = describePickCoverage(partial)
  check('and named to the creator', /1 with a buy link/.test(pmsg), pmsg)
  check('and explained', /no product link in the review/.test(pmsg), pmsg)
  check('the two messages differ', msg !== pmsg,
    'one message for both states is the same as no message')
}

// ── the wiring ──────────────────────────────────────────────────────────────
{
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const GUIDES = readFileSync('app/api/buying-guides/route.ts', 'utf8')
  const CMP = readFileSync('app/api/blog/comparison/route.ts', 'utf8')
  const PAGE = readFileSync('app/(dashboard)/buying-guides/page.tsx', 'utf8')

  check('the guide writer is told to emit markers', /MVP_MEDIA_\{N\}/.test(GUIDES) && /MVP_CTA_\{N\}/.test(GUIDES))
  check('and is told not to write links itself', /Never write a URL anywhere in a pick section/.test(GUIDES),
    'a model that writes affiliate URLs is a model that can mistype one')
  check('the guide injects the blocks after writing', /injectPickBlocks\(html, guidePicks\)/.test(GUIDES))
  check('the buy link goes through the creator\'s link style',
    /resolveCloakedLink\(/.test(GUIDES) && /postProductDestination\(/.test(GUIDES),
    'the stored geni.us code on its own is what put dead links on a Passport creator\'s posts')
  check('Amazon is asserted from the destination, not the cloaked link',
    /buyIsAmazon: !!asin \|\| isAmazonProductUrl\(destination\)/.test(GUIDES))
  check('the guide reports its section coverage', /sectionsSummary/.test(GUIDES))
  check('and the page shows it', /sectionsSummary/.test(PAGE) && /toast\.warning/.test(PAGE))

  check('comparisons link the creator\'s own review too', /Read the full review/.test(CMP))
  check('and only when that review exists', /reviewUrlByVideo\.get\(p\.videoId\)/.test(CMP))
}

if (failures.length) {
  console.error(`\n❌ guide-pick-blocks: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ guide-pick-blocks: every section carries the video, the buy link and the review, and says which ones do not')
