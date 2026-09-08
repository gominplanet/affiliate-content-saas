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
  check('a rebuild that comes back in the wrong style is refused, not counted as a fix',
    /reason === 'restyle' && styleOfUrl\(affiliateUrl\) !== chosenStyle/.test(ROUTE),
    'swapping a plain link for another plain link would report success and change nothing')
  check('a working cloaked link is never quietly downgraded to a raw tagged URL',
    /newStyle === 'direct' && chosenStyle !== 'direct'/.test(ROUTE))
  check('and the guard reads styles, not a hardcoded domain list',
    !/const PASSPORT = \//.test(ROUTE),
    'geni.us to Bitly is a creator changing their mind, and a domain list refuses it')
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
