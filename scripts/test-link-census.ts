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
import { convertibleLinks, occurrenceCount } from '../lib/post-affiliate-links'

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
    c.unstyleable >= 2, `unstyleable=${c.unstyleable}`)
  check('the one real Geniuslink is on-style',
    c.onStyle === 1, `on=${c.onStyle}`)
  // The TAGGED Amazon search link counts as off-style, because the repair tool
  // converts it and somebody earns on the click. Filing it under "no link
  // style" is what made this panel contradict itself on Rob's card.
  check('a tagged Amazon search link is work, not scenery',
    c.total === 2 && c.offStyle === 1, `total=${c.total} off=${c.offStyle}`)
  check('Walmart and Target are the ones left alone',
    c.unstyleable === 2, `unstyleable=${c.unstyleable}`)
  check('a plain internal link is not a retailer link at all',
    retailerHrefs(MIXED).length === 4, `${retailerHrefs(MIXED).length}`)
  check('the sentence discloses the links it will leave alone',
    /further retailer links are on another store or carry no Amazon tag, so they are left alone/.test(String(describeCensus(c, 'Geniuslink'))),
    String(describeCensus(c, 'Geniuslink')))
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

// ── the two numbers on the card must be the same number ─────────────────────
//
// 18 Sep, from Rob's card after the extras branch shipped. Two lines, one panel:
//
//   "7 of 18 affiliate links are NOT Geniuslink, across 3 posts"
//   "4 of 4 posts can be re-pointed by this tool"
//
// Three posts affected, four posts offered. The fourth post's only fault was a
// tagged Amazon SEARCH link, and the two halves of the panel were classifying it
// with different functions: the census used styleOfUrl, which answers null for a
// search url because it cannot read a product out of one, while the repair tool
// used currentStyleOf, which calls a tagged search link 'direct' because
// somebody earns on that click. Both were right about their own question and the
// panel contradicted itself, which is the exact fault this file was written to
// stop, reintroduced inside the fix for it.
//
// Pinned as an invariant rather than as a wording check, because wording drifts
// and the invariant is the thing that matters: EVERY link the census calls
// off-style is a link the tool will convert, and vice versa.
{
  const CASES: Array<[string, string]> = [
    ['Rob, all raw', ROB_BODY],
    ['a tagged search link among Geniuslinks', `
      <a href="https://geni.us/buy">Buy</a>
      <a href="https://www.amazon.com/s?k=kids+headphones&tag=laststop-20">Browse</a>
    `],
    ['an untagged Amazon link nobody earns on', `
      <a href="https://geni.us/buy">Buy</a>
      <a href="https://www.amazon.com/dp/B0CX23K9QL">Product page</a>
    `],
    ['other retailers', `
      <a href="https://geni.us/buy">Buy</a>
      <a href="https://www.walmart.com/ip/1">Walmart</a>
      <a href="https://www.target.com/p/x/-/A-1">Target</a>
    `],
    ['the same link four times', `
      ${'<a href="https://www.amazon.com/dp/B0DHL4MN12?tag=x-20">Buy</a>'.repeat(4)}
    `],
  ]
  for (const [label, body] of CASES) {
    const census = buildLinkCensus([{ id: 'x', title: label, content: body }], 'geniuslink')
    const willConvert = occurrenceCount(convertibleLinks(body, 'geniuslink'))
    check(`census and repair tool agree on "${label}"`,
      census.offStyle === willConvert,
      `census says ${census.offStyle} off-style, the tool will convert ${willConvert}`)
  }
}

// ── the post the tool could never offer to fix ──────────────────────────────
//
// 18 Sep, read straight off the census the day it shipped. The same creator's
// card now said:
//
//   "1 of 4 posts can be re-pointed · 2 more carry off-style links it will not
//    touch · 3 not offered (the link checked was on-style)"
//   "1 of 5 off-style · Samsers Foldable Keyboard and Mouse Combo Review"
//   "1 of 4 off-style · YOLEO Commercial Weight Bench Review"
//
// Those two posts could never be offered, on any run, in any mode. The scan
// reads ONE link per post, theirs passed, and they left by the door marked
// already-correct. The apply step has converted every link on a page since the
// sticky-bar fix, so the capability existed the whole time and nothing could
// reach it.
//
// The shape, exactly: a geni.us buy button (which ranks first and is what the
// scan examines) plus one raw tagged Amazon link further down the page.
{
  const SAMSERS = `
    <a class="gr-cta-btn" href="https://geni.us/samsers-kb">Check Price</a>
    <a class="gr-price-strip-btn" href="https://geni.us/samsers-kb">See price</a>
    <p>The <a href="https://www.amazon.com/dp/B0CX23K9QL?tag=laststop-20">folding stand</a> pairs with it.</p>
    <a class="mvp-sc-btn" href="https://geni.us/samsers-kb">Shop everything</a>
  `
  const census = buildLinkCensus([{ id: 's', title: 'Samsers', content: SAMSERS }], 'geniuslink')
  check('the census sees the one stray link the scan was blind to',
    census.offStyle === 1 && census.total === 4, `off=${census.offStyle} total=${census.total}`)

  // THE PREDICATE THAT NOW DRIVES SELECTION. convertibleLinks is the same
  // function the apply step uses to convert those links, so a post is offered
  // on exactly the condition that there is work the tool can actually do.
  const work = convertibleLinks(SAMSERS, 'geniuslink')
  check('convertibleLinks finds work on a post whose buy button is already right',
    work.length === 1 && /B0CX23K9QL/.test(work[0].url), JSON.stringify(work))
  check('and finds none on a post that is genuinely all Geniuslink',
    convertibleLinks('<a href="https://geni.us/a">x</a><a href="https://geni.us/b">y</a>', 'geniuslink').length === 0)
  check('an untagged Amazon link is not work: nobody earns on it',
    convertibleLinks('<a href="https://www.amazon.com/dp/B0CX23K9QL">x</a>', 'geniuslink').length === 0,
    'cloaking it would burn a Geniuslink on a page that pays nothing')

  check('the scan offers a post on that predicate, not on its one best link',
    /restyleMode && convertible\.length > 0/.test(ROUTE_LIVE) && /reason: 'extras'/.test(ROUTE_LIVE),
    'this is the branch those two posts needed')
  check('and the predicate is the same one the apply step converts with',
    /const convertible = convertibleLinks\(content, chosenStyle\)/.test(ROUTE_LIVE),
    'a second, looser predicate here would offer posts the apply step then leaves unchanged')

  // AN EXTRAS ROW MUST NOT SPEND THE CREATOR'S QUOTA ON A LINK THAT IS RIGHT.
  // Falling through to the normal path would mint a fresh geni.us to replace a
  // working geni.us: a charge, a new shortcode, and no change a reader sees.
  check('an extras row is detected from the post, not from the client',
    /const primaryUrl = bodyLinkOf\(original\)/.test(ROUTE_LIVE) && /const extrasOnly = !!primaryUrl/.test(ROUTE_LIVE),
    'a client that could declare "extras only" would be trusted with the Geniuslink account')
  check('an extras row skips the mint',
    /if \(!extrasOnly && !\/\^https\?:\\\/\\\/\/i\.test\(newUrl\)\)/.test(ROUTE_LIVE))
  check('and skips the primary swap',
    /let updated = original\n\s*if \(!extrasOnly\) \{/.test(ROUTE_LIVE))
  check('and never blanks the stored product link on the video row',
    /if \(row\.video_id && \/\^https\?:\\\/\\\/\/i\.test\(newUrl\)\)/.test(ROUTE_LIVE),
    'an empty newUrl written here removes one of the four sources the next repair resolves from')

  check('the preview names extras rows as their own kind',
    /reason === 'extras'/.test(CONTENT_LIVE) && /Other links/.test(CONTENT_LIVE),
    'ticking one agrees to something different: the main button does not change')
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
