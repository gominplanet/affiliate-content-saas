// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// COUNT THE LINKS, NOT THE POSTS.
//
// 17 Sep 2026. A creator's admin card read:
//
//   "Style: Geniuslink · 1 of 4 would be re-pointed · 3 already correct"
//
// His live page, opened the same minute, carried eight Amazon links and no
// Geniuslinks. Reading the stored body of his newest post through the WordPress
// REST API found six raw Amazon URLs and zero geni.us. Both the reassuring
// sentence and the page were produced by MVP that afternoon.
//
// Neither number was a lie about its own question. The preview examines ONE link
// per post: the product URL from the video row, or the best-ranked affiliate
// href in the body. It classifies that single link and then counts POSTS. "3
// already correct" meant "on three posts, the one link I looked at was on-style"
// — and a post with no source video row is skipped before it is looked at at
// all, so it cannot even reach that column.
//
// This file pins the replacement and, more importantly, pins the fact that the
// old sentence can never come back: an all-clear now has to survive a count of
// every href in every body.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildLinkCensus, describeCensus, retailerHrefs } from '../lib/link-census'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
/** Source with comments removed. A guard that matches a comment describing the
 *  bug passes on a file where the fix was reverted, which is worse than no
 *  guard: this repo has shipped that mistake before. */
const live = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const ROUTE = read('app/api/blog/fix-affiliate-links/route.ts')
const ROUTE_LIVE = live(ROUTE)
const ADMIN = read('app/(dashboard)/admin/users/page.tsx')
const ADMIN_LIVE = live(ADMIN)
const CONTENT = read('app/(dashboard)/content/page.tsx')
const CONTENT_LIVE = live(CONTENT)

// ── Rob's post, as the database actually holds it ───────────────────────────
//
// Six raw Amazon links, no Geniuslinks, chosen style Geniuslink. The shape that
// the old counter reported as one post needing a fix.
const ROB_BODY = `
<p>Here are my picks.</p>
<a class="gr-cta-btn" href="https://www.amazon.com/dp/B0DHL4MN12?tag=laststop-20">Check Price</a>
<a class="gr-price-strip-btn" href="https://www.amazon.com/dp/B0DHL4MN12?tag=laststop-20">See on Amazon</a>
<p>The <a href="https://www.amazon.com/dp/B0CX23K9QL?tag=laststop-20">runner up</a> is solid.</p>
<a class="mvp-mobile-buy-bar" href="https://www.amazon.com/dp/B0CX23K9QL?tag=laststop-20">Buy</a>
<a class="mvp-sc-btn" href="https://www.amazon.com/dp/B0F3PP7RR9?tag=laststop-20">Shop everything</a>
<a href="https://www.amazon.com/dp/B0F3PP7RR9?tag=laststop-20&#038;ascsubtag=xyz">Product page</a>
`

{
  const census = buildLinkCensus([{ id: 'p60', title: 'Wireless Kids Headphones', content: ROB_BODY }], 'geniuslink')
  check('every raw Amazon link on the page is counted, not one per post',
    census.total === 6, `counted ${census.total}, the page has 6`)
  check('and all six are reported off-style',
    census.offStyle === 6 && census.onStyle === 0, `off=${census.offStyle} on=${census.onStyle}`)
  check('the post is named once, not six times',
    census.postsAffected === 1)
  check('the worst list carries the title a creator recognises',
    census.worst[0]?.title === 'Wireless Kids Headphones' && census.worst[0]?.offStyle === 6)

  // THE SENTENCE ITSELF. This is the artifact the creator reads, and the reason
  // the old one was harmful is that it was reassuring while being technically
  // true, so the replacement is asserted word-shape and all.
  const note = describeCensus(census, 'Geniuslink')
  check('the sentence leads with links, not posts',
    !!note && /^6 of 6 affiliate links are NOT Geniuslink/.test(note), String(note))
  check('and says explicitly that it counted link by link',
    !!note && /link by link, not one link per post/.test(note), String(note))
  check('the sentence never reads as an all-clear when links are off-style',
    !!note && !/already correct|all clear|every buy link works/i.test(note), String(note))

  // The same duplicate URL appearing twice is two links a reader can click.
  // Deduplicating would have made Rob's six read as three, which is the same
  // undercount in a smaller place.
  check('a link repeated in the body counts every time it appears',
    retailerHrefs(ROB_BODY).length === 6, `${retailerHrefs(ROB_BODY).length}`)
  // WordPress writes `&#038;` where the editor wrote `&`. It does not change
  // whether the href is FOUND, so asserting the count here would pass with the
  // decoding removed and prove nothing. What it changes is the URL handed back,
  // and a caller comparing that string against one read from anywhere else is
  // the mismatch that has bitten URL swaps in this codebase before.
  check('the URL comes back decoded, not carrying the WordPress entity',
    retailerHrefs('<a href="https://www.amazon.com/dp/B0F3PP7RR9?tag=x&#038;k=1">x</a>')[0]
      === 'https://www.amazon.com/dp/B0F3PP7RR9?tag=x&k=1',
    retailerHrefs('<a href="https://www.amazon.com/dp/B0F3PP7RR9?tag=x&#038;k=1">x</a>')[0])
}

// ── what must NOT be called off-style ───────────────────────────────────────
//
// Inventing work is the mirror failure of hiding it, and it is the easier one to
// ship: widen the regex, watch the number go up, call it thorough. A Walmart
// link on a Walmart post is not a broken Geniuslink, and an Amazon search link
// is navigation. Both are counted and shown, in their own bucket, so the census
// never silently drops a link a reader can see either.
{
  const MIXED = `
    <a href="https://geni.us/abc123">Buy on Amazon</a>
    <a href="https://www.walmart.com/ip/12345">Walmart option</a>
    <a href="https://www.amazon.com/s?k=kids+headphones&tag=laststop-20">Browse all</a>
    <a href="https://www.target.com/p/thing/-/A-1234">Target option</a>
    <a href="https://example.com/blog/other-post">Related reading</a>
  `
  const c = buildLinkCensus([{ id: 'p1', title: 'Mixed', content: MIXED }], 'geniuslink')
  check('a Walmart link is not counted as a failed Geniuslink',
    c.offStyle === 0, `off=${c.offStyle}`)
  check('the one real Geniuslink is on-style',
    c.total === 1 && c.onStyle === 1, `total=${c.total} on=${c.onStyle}`)
  check('search, Walmart and Target links are still counted somewhere',
    c.other === 3, `other=${c.other}`)
  check('a plain internal link is not a retailer link at all',
    retailerHrefs(MIXED).length === 4, `${retailerHrefs(MIXED).length}`)
  check('the all-good sentence still discloses the links it set aside',
    /further retailer links are search, storefront or non-Amazon/.test(String(describeCensus(c, 'Geniuslink'))),
    String(describeCensus(c, 'Geniuslink')))
  check('a post with no off-style links is not named as an offender',
    c.postsAffected === 0 && c.worst.length === 0)
}

// ── a genuinely clean site still reads clean ────────────────────────────────
{
  const c = buildLinkCensus([
    { id: 'a', title: 'One', content: '<a href="https://geni.us/aaa">Buy</a><a href="https://geni.us/aaa">Buy</a>' },
    { id: 'b', title: 'Two', content: '<a href="https://geni.us/bbb">Buy</a>' },
  ], 'geniuslink')
  check('a clean site reports every link as on-style',
    c.total === 3 && c.offStyle === 0)
  check('and says so in links, with the count a creator can verify',
    /^All 3 affiliate links across your 2 posts are Geniuslink links\./.test(String(describeCensus(c, 'Geniuslink'))),
    String(describeCensus(c, 'Geniuslink')))
  // Every count in this sentence is read by a creator comparing it against
  // their own page, so a stray "1 posts" is the sentence looking generated
  // rather than measured.
  const one = buildLinkCensus([{ id: 'a', title: 'One', content: '<a href="https://geni.us/aaa">Buy</a>' }], 'geniuslink')
  check('the singular reads as English',
    describeCensus(one, 'Geniuslink') === 'The one affiliate link across your 1 post is a Geniuslink link.',
    String(describeCensus(one, 'Geniuslink')))
  check('a site with nothing to say says nothing',
    describeCensus(buildLinkCensus([{ id: 'x', title: 'x', content: '<p>no links</p>' }], 'geniuslink'), 'Geniuslink') === null)
}

// ── Passport, and a creator who moved styles ────────────────────────────────
{
  const BODY = `
    <a href="https://www.mvpl.ink/k3nx">Buy</a>
    <a href="https://geni.us/old1">Old link</a>
    <a href="https://www.amazon.com/dp/B0DHL4MN12?tag=x-20">Raw</a>
  `
  const c = buildLinkCensus([{ id: 'p', title: 'Moved', content: BODY }], 'passport')
  check('a Passport creator sees their own links as on-style',
    c.onStyle === 1, `on=${c.onStyle}`)
  check('and the leftover geni.us and raw links as the work',
    c.offStyle === 2, `off=${c.offStyle}`)
}

// ── the wiring: the route returns it ────────────────────────────────────────
{
  check('the preview builds a census over every scanned post',
    /buildLinkCensus\(/.test(ROUTE_LIVE) && /linkCensus: census/.test(ROUTE_LIVE),
    'a module nothing calls is not a fix')
  check('and returns the sentence alongside it',
    /censusNote: describeCensus\(/.test(ROUTE_LIVE))
  check('the census reads the stored body of each row, not the candidate list',
    /rows\.map\(\(r\) => \(\{ id: r\.id, title: r\.title, content: r\.content \}\)\)/.test(ROUTE_LIVE),
    'building it from candidates would reproduce the original undercount exactly')
}

// ── the wiring: a failed mint is no longer a bare continue ──────────────────
//
// resolveCloakedLinkDetailed exists solely so a caller can say why a cloak did
// not happen. This loop was discarding it, which is the bug that function was
// written to end, reintroduced one level up.
{
  check('a link that came back uncloaked records why',
    /mintFailures\[why\] = \(mintFailures\[why\] \|\| 0\) \+ 1/.test(ROUTE_LIVE))
  check('and the reason comes from the resolver, not from a guess',
    /cloaked\.reason/.test(ROUTE_LIVE))
  check('the apply response carries the count',
    /mintFailureCount:/.test(ROUTE_LIVE) && /mintFailures,/.test(ROUTE_LIVE))
  check('and a sentence built by the shared note writer',
    /mintFailureNote: firstMintFailure \? cloakFallbackNote\(firstMintFailure\)/.test(ROUTE_LIVE),
    'a second hand-written copy of those messages is how they drift')
  check('the skip is still a skip: a failed mint must never be written back',
    /if \(!cloaked\.cloaked \|\| styleOfUrl\(cloaked\.url\) !== chosenStyle\) \{/.test(ROUTE_LIVE),
    'reporting the failure is not a licence to publish the plain link as a conversion')
}

// ── the wiring: the screens read it ─────────────────────────────────────────
{
  check('the admin card shows the census sentence',
    /censusNote/.test(ADMIN_LIVE) && /headline/.test(ADMIN_LIVE))
  check('the admin card no longer claims posts are "already correct"',
    !/`\$\{sk\.alreadyRight\} already correct`/.test(ADMIN_LIVE),
    'that exact string was shown about a site whose pages carried raw Amazon links')
  check('the admin card names the gap between what is wrong and what it can fix',
    /more carry off-style links it will not touch/.test(ADMIN_LIVE),
    'the posts the button will not touch are the support question')
  check('the admin card lists the worst posts by link count',
    /off-style · \{w\.title\}/.test(ADMIN) || /w\.offStyle\} of \{w\.total\} off-style/.test(ADMIN))

  check('the creator preview shows the census too',
    /affCensusNote/.test(CONTENT_LIVE) && /data\.censusNote/.test(CONTENT_LIVE),
    'the creator is the one who can actually fix their credentials')
  check('the empty scan checks the census before claiming an all-clear',
    /censusOff > 0 && stuck === 0/.test(CONTENT_LIVE),
    'this is the branch that told a creator with six raw links that he was fine')
  check('the all-clear quotes a measured number rather than asserting a state',
    /All \$\{census\.total\} buy link/.test(CONTENT_LIVE) && !/Every buy link works and already uses/.test(CONTENT_LIVE),
    '"every buy link works" had nothing behind it')
  check('the apply summary reports links it could not convert',
    /mintFailureCount/.test(CONTENT_LIVE) && /could NOT be converted/.test(CONTENT_LIVE))
  check('and both the zero-fixed and the some-fixed branch say it',
    (CONTENT_LIVE.match(/\$\{mintNoteText\}/g) || []).length >= 2,
    'a run that fixed 25 and silently failed 40 links printed only the 25')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
