// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does the copy beside a cloaked link still say Amazon?
//
// Amazon Associates policy 6(w): "You will not use a link shortening service,
// button, hyperlink or other ad placement in a manner that makes it unclear
// that you are linking to an Amazon Site." Nobody reads mvpl.ink/x7k or
// geni.us/abc as Amazon, so the words next to it are the only thing that makes
// it clear, and an unclear placement is an account-termination risk, not a
// style note.
//
// The bug this locks out: the code decided "is this Amazon?" by pattern-matching
// the URL, which a cloaked link defeats by design. The moment a creator picked
// Passport or Geniuslink — the two styles MVP actively recommends — their posts
// started saying "Get it here" next to a short link, and the blog CTA swapped
// the Amazon Associate disclosure for "the seller's website". The safest link
// styles produced the least compliant copy.
import { composeCaption, effectiveDisclosure, isAmazonLink } from '../lib/social-link-mode'
import { renderPriceStrip } from '../lib/price-strip'
import { renderMessage } from '../lib/ig-dm'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const PASSPORT = 'https://www.mvpl.ink/x7k9'
const GENIUS = 'https://geni.us/abc123'
const RAW = 'https://www.amazon.com/dp/B0CT8HW471?tag=someone-20'

// ── the social CTA names the retailer ───────────────────────────────────────
for (const [label, link] of [['Passport', PASSPORT], ['Geniuslink', GENIUS], ['raw Amazon', RAW]] as const) {
  const caption = composeCaption({
    product: true, content: 'blog', writeUp: 'A short review.',
    blogUrl: 'https://example.com/post', videoUrl: null,
    affiliateLink: link,
    disclosure: effectiveDisclosure('', link, true),
    amazonDestination: true,
  })
  check(`${label}: the CTA says Amazon`, /on Amazon/i.test(caption), caption.split('\n')[0])
  check(`${label}: the disclosure is present`, /Amazon Associate/i.test(caption), caption)
}

// A link that genuinely is not Amazon must NOT claim it is.
{
  const caption = composeCaption({
    product: true, content: 'none', writeUp: 'x',
    blogUrl: null, videoUrl: null, affiliateLink: 'https://brand.com/product',
    disclosure: '', amazonDestination: false,
  })
  check('a non-Amazon link is never labelled Amazon', !/on Amazon/i.test(caption), caption)
}

// ── the blog CTA names the retailer and keeps the Associate line ────────────
for (const [label, link] of [['Passport', PASSPORT], ['Geniuslink', GENIUS]] as const) {
  const html = renderPriceStrip({ affiliateUrl: link, isAmazon: true, productName: 'K-Swiss Sneaker' })
  check(`${label} blog CTA says Amazon`, /on Amazon/i.test(html), html.slice(0, 200))
  check(`${label} blog CTA carries the Associate disclosure`,
    /As an Amazon Associate we earn from qualifying purchases/i.test(html), html.slice(0, 400))
  check(`${label} blog CTA says where the click goes`, /Clicking takes you to Amazon/i.test(html))
}

// ── the URL sniffer must stay honest about what it can see ──────────────────
// It is not wrong, it is just blind to a cloaked link, which is why callers pass
// what they know instead of asking it.
{
  check('a raw Amazon URL is recognisable', isAmazonLink(RAW))
  check('a Passport link is NOT recognisable from its URL', !isAmazonLink(PASSPORT))
  check('a geni.us link is NOT recognisable from its URL', !isAmazonLink(GENIUS))
}

// ── a DM carrying an affiliate link says both things ────────────────────────
// The least transparent place a link can land: a private message, no page
// around it, a template the creator wrote months ago. The default template was
// "Here you go 🔗 {link}" and nothing else.
{
  const dm = renderMessage('', PASSPORT, true)
  check('the DM names Amazon', /amazon/i.test(dm), dm)
  check('the DM carries a disclosure', /Amazon Associate|affiliate/i.test(dm), dm)

  const written = renderMessage('Grab it on Amazon here: {link} #ad', PASSPORT, true)
  check('a creator who already said it is not corrected',
    (written.match(/amazon/gi) || []).length <= 2 && !/This link goes to Amazon/.test(written), written)

  const nonAmazon = renderMessage('', 'https://brand.com/p', false)
  check('a non-Amazon DM never claims Amazon', !/goes to Amazon/i.test(nonAmazon), nonAmazon)
}

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
