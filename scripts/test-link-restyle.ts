// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The repair tool has to look at the fault the creator actually has.
//
// A creator with Geniuslink selected in Brand Profile clicked Fix Affiliate
// Links and was told "No broken affiliate links found across N posts." True,
// and useless: every buy link on his site was a plain tagged amazon.com/dp/
// URL. Nothing was broken. Nothing was his. The tool only ever scanned for dead
// links, so the one thing wrong was the one thing it never looked at, and the
// all-clear it printed was indistinguishable from a real all-clear.
//
// Two things are pinned here. First that a link's style can be read off the URL
// at all, because comparing what a creator got against what they chose is
// impossible without it. Second that the empty scan now reports what it
// established rather than what it looked for.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { styleOfUrl, pickLinkStyle } from '../lib/link-style'
import { passportCodeFromUrl, passportLinkUrl } from '../lib/passport-links'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const ROUTE = read('app/api/blog/fix-affiliate-links/route.ts')
const CONTENT = read('app/(dashboard)/content/page.tsx')
const RESOLVE = read('lib/affiliate-resolve.ts')

// ── reading the style off a live URL ────────────────────────────────────────
{
  const cases: [string, ReturnType<typeof styleOfUrl>][] = [
    // The exact link that started this: works, earns, and is not what he chose.
    ['https://www.amazon.com/dp/B0H986NKLH?tag=alejandrogime-20&ascsubtag=80cHCuOkfz8', 'direct'],
    ['https://geni.us/abc123', 'geniuslink'],
    ['https://gnz.io/xyz', 'geniuslink'],
    ['https://www.mvpl.ink/k3nx', 'passport'],
    ['https://mvpl.ink/k3nx', 'passport'],
    ['https://www.mvpaffiliate.io/go/k3nx', 'passport'],
    ['https://bit.ly/3xYz', 'bitly'],
    // Amazon's own shorteners carry the tag inside them. They are a direct
    // link in a smaller wrapper, not a cloaker anybody picked.
    ['https://amzn.to/3abcd', 'direct'],
    ['https://a.co/d/abcd', 'direct'],
    // Nothing to read. Must be null, never a guess: a wrong answer here
    // rewrites somebody's published post.
    // An Amazon SEARCH link with the creator's tag on it. A real Amazon URL,
    // and not a buy link for anything. Reading it as 'direct' made a post whose
    // actual button is a geni.us link report as the wrong style, and sent the
    // repair tool hunting for a product id on a search page. Seen live on
    // "Goodeco Dog Statue with Solar Lantern Review".
    ['https://www.amazon.com/s?k=Solar%20Dog%20Statue&tag=gomin0e-20', null],
    ['https://www.amazon.com/stores/page/ABC123', null],
    ['https://www.amazon.com/dp/B0H986NKLH', 'direct'],
    ['https://brandstore.com/products/thing', null],
    ['/relative/path', null],
    ['', null],
  ]
  for (const [url, want] of cases) {
    check(`styleOfUrl(${url || '""'}) is ${want}`, styleOfUrl(url) === want, `got ${styleOfUrl(url)}`)
  }
  // ── the two Passport recognisers must agree ───────────────────────────────
  // styleOfUrl restates passportCodeFromUrl's rules rather than importing them
  // (lib/link-style is dependency-free on purpose). A restatement that drifts is
  // the exact failure this file guards, and here it would be a bad one: the
  // repair tool would mint a Passport link, read it back as the wrong style,
  // refuse its own work, and tell a Passport creator their posts cannot be
  // converted.
  for (const u of [
    'https://www.mvpl.ink/k3nx',
    'https://mvpl.ink/abcd1234',
    'https://www.mvpaffiliate.io/go/k3nx',
    'https://www.mvpl.ink/x7k',            // 3 chars: below the code minimum
    'https://www.mvpl.ink/pricing',        // a real page on the domain, not a code
    'https://www.mvpl.ink/deep/path/here',
    'https://www.amazon.com/dp/B0H986NKLH',
    'https://geni.us/abc',
  ]) {
    const byCode = passportCodeFromUrl(u) !== null
    const byStyle = styleOfUrl(u) === 'passport'
    check(`both recognisers agree on ${u}`, byCode === byStyle,
      `passportCodeFromUrl=${byCode} styleOfUrl=${byStyle}`)
  }
  // And the link MVP itself mints has to read back as Passport, or the tool
  // refuses every conversion it just performed.
  check('a freshly minted Passport URL reads as passport',
    styleOfUrl(passportLinkUrl('k3nx')) === 'passport',
    `passportLinkUrl gave ${passportLinkUrl('k3nx')}`)

  // The pair has to line up, because the whole comparison is
  // styleOfUrl(live) !== pickLinkStyle(settings).
  check('a Geniuslink creator with a plain Amazon link reads as off-style',
    styleOfUrl('https://www.amazon.com/dp/B0H986NKLH?tag=x-20')
      !== pickLinkStyle({ passportEligible: false, mode: 'geniuslink', hasBitly: false, hasGeniuslink: true }))
  check('and the same creator with a geni.us link reads as correct',
    styleOfUrl('https://geni.us/abc')
      === pickLinkStyle({ passportEligible: false, mode: 'geniuslink', hasBitly: false, hasGeniuslink: true }))
}

// ── the route scans for off-style links, and by default ─────────────────────
{
  check('the route knows the restyle reason', /'restyle'/.test(ROUTE))
  check('an unrecognised or absent mode defaults to the combined scan',
    /:\s*'all'/.test(ROUTE),
    'a creator clicking one button called Fix Affiliate Links should not have to already know which fault they have')
  check('it reads the creator\'s chosen style through the shared function',
    /getLinkStyle\(/.test(ROUTE),
    'not its own idea of the style, or the preview disagrees with the next generation')
  check('it compares that against the style live on the page',
    /styleOfUrl\(/.test(ROUTE))
  // ── the preview does not mint, the apply does ─────────────────────────────
  // Building a candidate creates a real link: a Geniuslink shortcode, or a
  // Passport get-or-create. Doing that during a PREVIEW meant a creator with 267
  // off-style posts minted 267 links before agreeing to anything, and every row
  // they unticked left an orphan. It also forced a 25-per-run cap, which turned
  // "fix all my links" into eleven rounds of clicking.
  //
  // So a restyle row is previewed with no link at all and built at apply time,
  // for the posts actually ticked. That is what lets one scan cover every post.
  check('a restyle row is previewed WITHOUT building its link',
    /candidates\.push\(\{ post, video, oldUrl, newUrl: null, reason \}\)/.test(ROUTE),
    'a preview that mints is a preview that has to be capped, and the cap is the eleven-rounds problem')
  check('and the cap is gone with it',
    !/RESTYLE_BUDGET/.test(ROUTE),
    'covering every post in one pass is the whole point of moving the mint')
  check('the apply builds the link itself',
    /async function buildLinkFor\(/.test(ROUTE) && /const built = await buildLinkFor\(/.test(ROUTE),
    'the client must never hand back a URL the server did not make')
  check('a rebuild that comes back in the wrong style is refused there, not counted as a fix',
    /styleOfUrl\(built\) !== chosenStyle/.test(ROUTE),
    'swapping a plain link for another plain link would report success and change nothing')
  check('the scan skips the network probe for a post it is rebuilding anyway',
    /!\(restyleMode && offStyle\)/.test(ROUTE),
    'following 250 geni.us redirects to learn something the rebuild makes moot is how the scan times out')
  check('the apply re-reads the link a reader actually clicks',
    /const oldUrl = bodyLinkOf\(original\) \|\| f\.oldUrl/.test(ROUTE),
    'so a post edited between preview and apply is still matched')

  // ── re-pointing is not re-discovering ─────────────────────────────────────
  // The first real run failed with "could not resolve a product for this post"
  // on a post whose product was sitting in its own href. The apply called the
  // generic resolver, which re-derives the product from the video's title and
  // description as though writing a fresh post. For a geni.us post that means
  // following the geni.us link in the DESCRIPTION, so a creator migrating OFF
  // Geniuslink was blocked BY Geniuslink, which is the one dependency the whole
  // migration exists to remove.
  //
  // A published post already links to its product. Read it, do not rediscover it.
  check('the apply works out the product from the post itself',
    /async function asinForRestyle\(/.test(ROUTE))
  check('cheapest source first: an Amazon link already in the post body',
    /const inBody = content\.match\(/.test(ROUTE),
    'free, no network, and it is right there')
  check('then the ASIN stored on the video row',
    /const stored = ok\(video\.asin\)/.test(ROUTE))
  check('and only then follow the post\'s OWN links',
    /const finalUrl = await resolveTrueDestination\(candidate\)/.test(ROUTE),
    'the creator\'s own description of the fix: the geni.us link still points at a real product, so resolve it and cloak that')
  check('the video row is read with select(*), not named columns',
    /\.from\('youtube_videos'\)\.select\('\*'\)/.test(ROUTE),
    'asin ships in migration 204, and naming a column a database lacks makes PostgREST reject the whole read')
  check('the resolver can be told the product and skip discovery',
    /knownAsin\?: string \| null/.test(RESOLVE) && /if \(known && isValidAsin\(known\)\)/.test(RESOLVE),
    'rediscovery is slower, costs an AI call, and can return a DIFFERENT product than the post is about')
  check('and the apply passes it through',
    /knownAsin: knownAsin \?\? null/.test(ROUTE))
  check('a failure says which half failed',
    /found product \$\{knownAsin\} but could not build/.test(ROUTE),
    '"could not resolve a product" for a post that HAS a product sent the debugging in the wrong direction')

  check('the post\'s links are ranked, cloaked buy button first',
    /const bodyLinksOf = \(content: string\): string\[\] =>/.test(ROUTE)
      && /if \(GENIUSLINK\.test\(u\) \|\| SHORTENERS\.test\(u\) \|\| styleOfUrl\(u\) === 'passport'\) return 0/.test(ROUTE),
    'taking the first href in document order picked a comparison-block search link over the actual buy button')
  check('search and storefront URLs are dropped, not ranked last',
    /rank\(u\) < 2/.test(ROUTE),
    'they are navigation; nothing in a link repair should reason about them')
  check('and the product lookup tries every candidate link',
    /for \(const candidate of \[currentUrl, \.\.\.extraLinks\]/.test(ROUTE),
    'giving up after the first is how a post with a good geni.us button reported that nobody could tell what it was about')

  // ── one click, however many posts ─────────────────────────────────────────
  check('the client applies in batches',
    /const BATCH = 20/.test(CONTENT),
    'one request cannot mint and publish hundreds of posts inside a 300s function')
  check('and shows how far it has got',
    /affProgress/.test(CONTENT),
    'a button that just sits there for minutes reads as hung')
  check('a failed batch keeps what already succeeded',
    /Those are saved; run it again to continue/.test(CONTENT))
  check('a row with no built link says what it will become',
    /created when you apply/.test(CONTENT),
    'rather than printing an empty line where a URL should be')

  check('the scan reports what it established',
    /chosenStyleLabel/.test(ROUTE) && /offStyleStuck/.test(ROUTE),
    'so an empty result can say which kind of empty it is')
}

// ── the screen says which kind of empty ─────────────────────────────────────
{
  // The phrase still appears in a comment recording why it went, which is the
  // point of the comment, so only non-comment lines are searched.
  const liveLines = CONTENT.split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l))
  check('the old all-clear wording is no longer shown to anyone',
    !liveLines.some((l) => l.includes('No broken affiliate links found')),
    'that sentence was true and read as a clean bill of health while every link was the wrong style')
  check('the empty scan names the style that was checked for',
    /emptyScanMessage/.test(CONTENT) && /already uses \$\{style\}/.test(CONTENT))
  check('and names the posts it could not convert',
    /offStyleStuck/.test(CONTENT))
  check('applying zero fixes is reported as nothing written, not as nothing needed',
    /Nothing was written\./.test(CONTENT),
    'the user had just ticked boxes and pressed apply, so zero means the writes failed')
  check('each previewed row says whether it is broken or off-style',
    /Wrong style/.test(CONTENT) && /reason === 'broken'/.test(CONTENT),
    'agreeing to repair a dead link is a different decision from agreeing to re-mint a working one')
}

// ── progress is not painted as failure ──────────────────────────────────────
// The SCOUT fallback firing means the product is routing around an Amazon
// block, which is the recovery working. It printed in the same red as a dead
// generation and was reported as a bug, twice.
{
  const COPILOT = read('app/(dashboard)/co-pilot/page.tsx')
  check('the SCOUT fallback is a progress line',
    /setProgress\('Amazon blocked our server/.test(COPILOT))
  check('and no longer goes through the error channel',
    !/setError\('Amazon blocked our server/.test(COPILOT))
  check('progress renders in the brand colour, not the error colour',
    /\{progress &&[\s\S]{0,200}#7C3AED/.test(COPILOT))
  check('and is cleared when the run ends',
    /setGenerating\(false\)\s*\n\s*setProgress\(null\)/.test(COPILOT))
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
