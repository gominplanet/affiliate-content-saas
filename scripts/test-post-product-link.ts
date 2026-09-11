// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does a published post link where the creator told MVP to link?
//
// A creator moved to Passport Links and kept seeing geni.us links on their
// Facebook page months later. The cause was one line: the function that picks a
// post's product link answered with the geni.us code stored on the post, first
// and unconditionally, before it looked at anything else. Every post generated
// while Geniuslink was connected carries that code forever, so it outranked the
// creator's current setting on every surface that shares a post, and the
// comment-to-DM replies did not cloak at all and sent it verbatim.
//
// So this file asserts one thing in several shapes: nothing here picks a link
// provider. It returns a destination, the cloaker applies the creator's style,
// and the candidate it prefers is the one the cloaker can work with offline.
import { postProductDestination, postProductAsin } from '../lib/post-product-link'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const AMZ = 'https://www.amazon.com/dp/B0DHL5C3RF?tag=gomin-20'
const GENI = 'https://geni.us/cXNSl'

// ── the regression ──────────────────────────────────────────────────────────
// A post written while Geniuslink was connected. The code is on the row, the
// Amazon link is in the body, and the creator has since moved to Passport.
{
  const post = { geniuslink_code: 'cXNSl', content: `<p>Great pick. <a href="${AMZ}">Check price</a></p>` }
  check('the Amazon link wins over the stored geni.us code',
    postProductDestination(post) === AMZ, `${postProductDestination(post)}`)
  check('and the ASIN comes out of it with no network call',
    postProductAsin(post) === 'B0DHL5C3RF', `${postProductAsin(post)}`)
}

// ── position must not decide it ─────────────────────────────────────────────
// The old body scan was one regex with an alternation, so whichever link
// appeared FIRST won. A post that opens with a geni.us CTA and links Amazon
// further down would still hand back the geni.us.
{
  const post = {
    geniuslink_code: null,
    content: `<p>Buy: <a href="${GENI}">here</a></p><p>Or direct: <a href="${AMZ}">Amazon</a></p>`,
  }
  check('an Amazon link later in the body still wins',
    postProductDestination(post) === AMZ, `${postProductDestination(post)}`)
}

// ── the last resorts, in order ──────────────────────────────────────────────
{
  const geniOnly = { geniuslink_code: null, content: `<p><a href="${GENI}">Buy</a></p>` }
  check('a geni.us in the body is used when there is no Amazon link',
    postProductDestination(geniOnly) === GENI, `${postProductDestination(geniOnly)}`)

  const codeOnly = { geniuslink_code: 'cXNSl', content: '<p>No links at all.</p>' }
  check('the stored code is the last resort, not the first',
    postProductDestination(codeOnly) === GENI, `${postProductDestination(codeOnly)}`)

  const nothing = { geniuslink_code: null, content: '<p>No links at all.</p>' }
  check('a post with no product link returns null rather than something invented',
    postProductDestination(nothing) === null, `${postProductDestination(nothing)}`)
}

// ── what counts as a product link ───────────────────────────────────────────
// A category page or a search result is not the product, and treating one as
// the buy link sends a reader somewhere they cannot buy.
{
  const category = { geniuslink_code: null, content: '<p><a href="https://www.amazon.com/s?k=beef+organ">Browse</a></p>' }
  check('an Amazon search URL is not treated as the product',
    postProductDestination(category) === null, `${postProductDestination(category)}`)

  const short = { geniuslink_code: null, content: '<p><a href="https://www.amazon.com/dp/B0DHL5">Buy</a></p>' }
  check('a malformed product id is not accepted',
    postProductDestination(short) === null, `${postProductDestination(short)}`)

  const gp = { geniuslink_code: null, content: '<p><a href="https://www.amazon.com/gp/product/B0DHL5C3RF">Buy</a></p>' }
  check('the older /gp/product/ form is accepted',
    postProductDestination(gp) === 'https://www.amazon.com/gp/product/B0DHL5C3RF', `${postProductDestination(gp)}`)
  check('and its ASIN reads too', postProductAsin(gp) === 'B0DHL5C3RF', `${postProductAsin(gp)}`)

  const uk = { geniuslink_code: null, content: `<p><a href="https://www.amazon.co.uk/dp/B0DHL5C3RF?tag=x">Buy</a></p>` }
  check('a non-US Amazon domain is still Amazon',
    /amazon\.co\.uk/.test(postProductDestination(uk) || ''), `${postProductDestination(uk)}`)
}

// ── the tag survives ────────────────────────────────────────────────────────
// The destination is handed to the cloaker, and for a creator on Direct it IS
// the published link, so dropping the query string would drop their commission.
{
  const post = { geniuslink_code: null, content: `<a href="${AMZ}&ascsubtag=blog">Buy</a>` }
  const out = postProductDestination(post) || ''
  check('the associate tag is kept', /tag=gomin-20/.test(out), out)
  check('and so is the attribution subtag', /ascsubtag=blog/.test(out), out)
}

// ── nothing here decides a provider ─────────────────────────────────────────
// The point of the whole file. A geni.us only ever comes back because it is the
// only thing the post has, never because this function preferred it.
{
  const withAmazon = { geniuslink_code: 'cXNSl', content: `<a href="${AMZ}">Buy</a>` }
  check('a stored geniuslink code never wins while a real destination exists',
    !/geni\.us/.test(postProductDestination(withAmazon) || ''), `${postProductDestination(withAmazon)}`)
}

// ── no product link, no ASIN ────────────────────────────────────────────────
{
  check('no body means no ASIN', postProductAsin({ content: null }) === null)
  check('a geni.us body means no ASIN, so the cloaker knows to unwrap',
    postProductAsin({ content: `<a href="${GENI}">Buy</a>` }) === null)
  check('a lowercase product id is normalised',
    postProductAsin({ content: '<a href="https://www.amazon.com/dp/b0dhl5c3rf">x</a>' }) === 'B0DHL5C3RF')
}

// ── the SECOND time this shipped ────────────────────────────────────────────
//
// 11 September. An auto-pilot cascade posted geni.us links to Facebook,
// Instagram and Bluesky from an account that had been on Passport for weeks.
// The first fix demoted the stored code to a last resort, and that was not
// enough: "last resort" was reached EVERY TIME for exactly the creators the fix
// was for.
//
// A Passport creator's post body contains mvpl.ink links and nothing else. No
// Amazon URL, no geni.us. Both body checks missed, and the only branch left was
// a geniuslink_code written months earlier. The post's own live, correct link
// was sitting in the body being ignored.
{
  const PASS = 'https://www.mvpl.ink/yYamC7'
  const post = { geniuslink_code: 'cXNSl', content: `<p>Nice. <a href="${PASS}">Check price on Amazon</a></p>` }
  check('the body\'s Passport link wins over a stored geni.us code',
    postProductDestination(post) === PASS, `${postProductDestination(post)}`)
  check('and no geni.us comes back at all',
    !/geni\.us/.test(postProductDestination(post) || ''), `${postProductDestination(post)}`)

  // The app-origin shape, for a post written before the branded domain.
  const viaGo = { geniuslink_code: 'cXNSl', content: '<a href="https://www.mvpaffiliate.io/go/yYamC7">Buy</a>' }
  check('the /go/<code> shape is recognised too',
    postProductDestination(viaGo) === 'https://www.mvpaffiliate.io/go/yYamC7', `${postProductDestination(viaGo)}`)

  // Amazon still outranks it: an ASIN needs no network call, and the cloaker can
  // mint a FRESH Passport link with correct per-surface attribution from it.
  const both = { geniuslink_code: null, content: `<a href="${PASS}">x</a> <a href="${AMZ}">y</a>` }
  check('a raw Amazon link still outranks a Passport link', postProductDestination(both) === AMZ,
    `${postProductDestination(both)}`)

  // A Passport link outranks a geni.us in the same body: it is the newer of the
  // two, whichever style the creator is on now.
  const mixed = { geniuslink_code: null, content: `<a href="${GENI}">old</a> <a href="${PASS}">new</a>` }
  check('a Passport link outranks a geni.us in the same body',
    postProductDestination(mixed) === PASS, `${postProductDestination(mixed)}`)
}

// ── the style can veto the stored code ──────────────────────────────────────
//
// The remaining hole: a post with NO product link anywhere in its body still
// fell through to the stored code. For anyone not on Geniuslink that is never
// the right answer, and it is worse than returning nothing, because nothing
// means the CTA is simply left off.
{
  const bare = { geniuslink_code: 'cXNSl', content: '<p>No product link in here at all.</p>' }
  check('with no style given the old behaviour stands',
    postProductDestination(bare) === 'https://geni.us/cXNSl', `${postProductDestination(bare)}`)
  check('a Passport creator gets nothing rather than a stale code',
    postProductDestination(bare, { linkStyle: 'passport' }) === null,
    `${postProductDestination(bare, { linkStyle: 'passport' })}`)
  check('a Direct creator too', postProductDestination(bare, { linkStyle: 'direct' }) === null)
  check('a Bitly creator too', postProductDestination(bare, { linkStyle: 'bitly' }) === null)
  check('a Geniuslink creator still gets their code',
    postProductDestination(bare, { linkStyle: 'geniuslink' }) === 'https://geni.us/cXNSl')

  // The veto applies ONLY to the stored code. A real destination in the body is
  // evidence from the post itself and no style may discard it.
  const withAmz = { geniuslink_code: 'cXNSl', content: `<a href="${AMZ}">Buy</a>` }
  check('the veto never discards a real link in the body',
    postProductDestination(withAmz, { linkStyle: 'passport' }) === AMZ,
    `${postProductDestination(withAmz, { linkStyle: 'passport' })}`)
}

// ── the callers pass the style ──────────────────────────────────────────────
//
// The veto only exists where somebody asks for it. The unattended cron is the
// one that matters most: it published the wrong link with nobody watching.
{
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  for (const f of [
    'app/api/blog/facebook-post/route.ts',
    'app/api/blog/bluesky-post/route.ts',
    'app/api/blog/linkedin-post/route.ts',
    'app/api/cron/process-scheduled/route.ts',
  ]) {
    const src = readFileSync(f, 'utf8')
    check(`${f} passes the creator's link style`, /linkStyle:\s*\w+LinkStyle/.test(src),
      'without it a stale stored code can still win on a post with no body link')
  }
}

// ── the link is right, the attribution has to be too ────────────────────────
//
// 248 of one creator's 298 posts carry a Passport link in the body. Now that
// those are read, every social share re-posts the BLOG's link, because that is
// what the body holds. The destination is correct and the attribution is not:
// every Facebook click would land in the analytics under 'blog'.
//
// A source assertion, because proving the re-mint behaviourally needs a live
// passport_links row and two Supabase clients, and would end up testing the stub.
{
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const SHARE = readFileSync('lib/blog-share-url.ts', 'utf8')

  check('a Passport link in hand is recognised before anything else',
    SHARE.indexOf('passportCodeFromUrl(link)') < SHARE.indexOf('asinFromAmazonUrl(link)'),
    'unwrapping it as if it were a short link would follow a redirect for nothing')
  check('its target is recovered', /passportTargetForCode\(userId, existingCode\)/.test(SHARE))
  check('and re-minted for THIS surface', /source: src, title/.test(SHARE))
  check('a failed re-mint still posts the working link', /return reminted \|\| link/.test(SHARE),
    'a post must never fail to go out over an attribution detail')

  const PASS = readFileSync('lib/passport-links.ts', 'utf8')
  check('the lookup is scoped to the owner',
    /from\('passport_links'\)[\s\S]{0,200}?eq\('user_id', userId\)/.test(PASS),
    'one creator must never read another creator\'s link target')
  check('and it refuses a malformed code before querying',
    /\^\[A-Za-z0-9\]\{4,16\}\$\/\.test\(c\)/.test(PASS))
}

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
