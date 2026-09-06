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

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
