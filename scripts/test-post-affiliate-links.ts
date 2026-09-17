// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE FIXER ONLY EVER LOOKED AT THE POST'S PRODUCT.
//
// A creator reported that Fix Affiliate Links converted four of eight links. His
// post holds ten. Four are the product. The other six are Amazon SEARCH links:
// the inline product-name links, the "Shop everything in this video" link and
// the sticky mobile button, which is the one phone readers press.
//
// The fixer never saw them, for a reason that was right at the time. It asks one
// question to work out what a post is about, and its own comment says:
//
//   "Search and storefront URLs are dropped entirely: they are navigation, not
//    a buy link, and nothing here should reason about them."
//
// Correct for that question. A post whose first link is a search for "MacBook
// Pro" is not a post about a MacBook Pro, and an earlier bug came from trying to
// read a product id out of one.
//
// Wrong for a DIFFERENT question: which links should carry the style the creator
// chose. A search link is tagged, a reader clicks it, a commission follows. One
// line of code answered both questions and only one answer was intended.
//
// The two ways this new rule can do harm:
//
//   too narrow   the sticky mobile button stays plain and the creator is told
//                the post was fixed, which is what was reported
//   too wide     an untagged Amazon help page gets a tracked link minted for it,
//                spending a creator's quota on a click nobody earns from
import {
  convertibleLinks, currentStyleOf, hasAffiliateTag, kindOf, mintCost, occurrenceCount,
} from '../lib/post-affiliate-links'
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const a = (href: string, cls = '') => `<a${cls ? ` class="${cls}"` : ''} href="${href}">x</a>`

const PRODUCT_ENC = 'https://www.amazon.com/dp/B0FWBHDFWK?tag=laststopreviewshop-20&#038;ascsubtag=Pnm'
const PRODUCT_RAW = 'https://www.amazon.com/dp/B0FWBHDFWK?tag=laststopreviewshop-20&ascsubtag=Pnm'
const SEARCH_A = 'https://www.amazon.com/s?k=MacBook%20Pro&#038;tag=laststopreviewshop-20'
const SEARCH_B = 'https://www.amazon.com/s?k=Blackview%20DCM6&#038;tag=laststopreviewshop-20'

// ── THE POST THAT WAS REPORTED, RECONSTRUCTED ─────────────────────────────
{
  const post = [
    a(SEARCH_A), a(PRODUCT_ENC), a(SEARCH_A),
    a(PRODUCT_ENC, 'gr-cta-btn'),
    a(PRODUCT_RAW, 'gr-price-strip-btn'),
    a(PRODUCT_ENC, 'gr-cta-btn'),
    a(SEARCH_B), a(SEARCH_B),
    a(SEARCH_A, 'mvp-mobile-buy-btn'),
    a(PRODUCT_ENC, 'mvp-sc-btn'),
  ].join('\n')

  const links = convertibleLinks(post, 'geniuslink')

  check('every place on the page is accounted for', occurrenceCount(links) === 10, String(occurrenceCount(links)))
  check('and it costs three links, not ten', mintCost(links) === 3, String(mintCost(links)))
  check('because the product is ONE destination however it is spelled',
    links.find(l => l.kind === 'product')?.count === 5,
    'minting one per occurrence would charge a creator five links that all point at the same page')

  check('both searches are found', links.filter(l => l.kind === 'search').length === 2)
  check('the sticky mobile button is covered',
    links.some(l => l.kind === 'search' && l.url.includes('MacBook')),
    'this is the one the creator called the most important miss')

  check('the product sorts first',
    links[0]?.kind === 'product',
    'if a cap is ever applied, the buy link is the one that must get through')
}

// ── too wide: things that must NOT be touched ─────────────────────────────
{
  const untagged = [
    'https://www.amazon.com/gp/help/customer/display.html',
    'https://www.amazon.com/b?node=12345',
    'https://www.amazon.com/s?k=laptop',
  ]
  for (const u of untagged) {
    check(`an untagged Amazon URL is left alone: ${u.slice(28, 60)}`,
      convertibleLinks(a(u), 'geniuslink').length === 0,
      'nobody earns on this click, so cloaking it spends a link for nothing')
    check(`and it is not called an affiliate link`, currentStyleOf(u) === null, u)
  }

  for (const u of [
    'https://thelaststopreviewshop.com/about/',
    'https://www.youtube.com/watch?v=abc',
    '/relative/path',
    'mailto:someone@example.com',
    '#anchor',
  ]) {
    check(`a non-affiliate link is left alone: ${u.slice(0, 34)}`,
      convertibleLinks(a(u), 'geniuslink').length === 0, u)
  }
}

// ── already in the chosen style: nothing to do ────────────────────────────
{
  const already = a('https://geni.us/abc123')
  check('a geni.us link is left alone when Geniuslink is the style',
    convertibleLinks(already, 'geniuslink').length === 0)
  check('but IS converted when the style is Passport',
    convertibleLinks(already, 'passport').length === 1,
    'a creator who switched styles has old links in the previous one')

  const bitly = a('https://bit.ly/xyz')
  check('a Bitly link is converted when Geniuslink is chosen',
    convertibleLinks(bitly, 'geniuslink').length === 1)
  check('and left alone when Bitly is chosen',
    convertibleLinks(bitly, 'bitly').length === 0)

  const direct = a(PRODUCT_ENC)
  check('a plain tagged product is left alone when Direct is the style',
    convertibleLinks(direct, 'direct').length === 0,
    'a creator on Direct has chosen plain links; rewriting them is not a fix')
}

// ── the tag is the bar ────────────────────────────────────────────────────
{
  check('a tagged URL has a tag', hasAffiliateTag(PRODUCT_ENC))
  check('an encoded ampersand does not hide it', hasAffiliateTag(SEARCH_A),
    'the tag sits after &#038; on every WordPress-stored link')
  check('an empty tag does not count', !hasAffiliateTag('https://www.amazon.com/s?k=x&tag='))
  check('no tag at all does not count', !hasAffiliateTag('https://www.amazon.com/s?k=x'))
  check('a lookalike parameter does not count',
    !hasAffiliateTag('https://www.amazon.com/s?k=x&tagline=y'),
    'a substring match here would cloak untagged pages')
  check('rubbish does not throw', !hasAffiliateTag('not a url'))
}

// ── the kinds are named correctly ─────────────────────────────────────────
{
  check('a /dp/ URL is a product', kindOf(PRODUCT_ENC) === 'product', kindOf(PRODUCT_ENC))
  check('an /s?k= URL is a search', kindOf(SEARCH_A) === 'search', kindOf(SEARCH_A))
  check('a geni.us URL is cloaked', kindOf('https://geni.us/x') === 'cloaked')
  check('an amzn.to URL is cloaked-shaped', kindOf('https://amzn.to/x') === 'cloaked')
  check('a storefront is neither', kindOf('https://www.amazon.com/shops/abc?tag=x') === 'storefront')
}

// ── Amazon's own shorteners are direct, not a style the creator picked ────
{
  const short = a('https://amzn.to/4abcd')
  const links = convertibleLinks(short, 'geniuslink')
  check('an amzn.to link is converted to the chosen style', links.length === 1, String(links.length))
  check('and is reported as direct today', links[0]?.style === 'direct', String(links[0]?.style))
}

// ── nothing blows up on nothing ───────────────────────────────────────────
{
  for (const html of ['', '<p>no links here</p>', '<a>no href</a>', '<a href="">empty</a>']) {
    check(`no crash on ${JSON.stringify(html).slice(0, 26)}`, convertibleLinks(html, 'geniuslink').length === 0)
  }
  check('counts of an empty list are zero',
    mintCost([]) === 0 && occurrenceCount([]) === 0)
}

// ── AND THE FIXER ACTUALLY USES IT ────────────────────────────────────────
//
// The rule above is worth nothing if the route still asks the old question.
// Checked on the source, because what was wrong was a filter in a helper and no
// pure function can see that from outside.
{
  const strip = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

  const route = strip(readFileSync('app/api/blog/fix-affiliate-links/route.ts', 'utf8'))
  const ui = strip(readFileSync('app/(dashboard)/content/page.tsx', 'utf8'))

  check('the fixer converts the other links too', /convertibleLinks\(updated, chosenStyle\)/.test(route),
    'without this only the post\'s own product link is ever repointed')
  check('each destination gets its OWN cloaked link', /resolveCloakedLinkDetailed\(\{/.test(route),
    'pointing a MacBook search at the Blackview product would be worse than leaving it plain')
  check('and a link that came back in the wrong style is not written',
    /!cloaked\.cloaked \|\| styleOfUrl\(cloaked\.url\) !== chosenStyle/.test(route),
    'a fallback returns the destination unchanged, and writing that back counts a conversion that did not happen')
  check('the mint cost is capped', /MAX_EXTRA_LINKS_PER_POST/.test(route),
    'a nine-product roundup is nine links off the creator\'s quota')
  check('one failure does not abandon the post', /One link failing must not abandon/.test(
    readFileSync('app/api/blog/fix-affiliate-links/route.ts', 'utf8')))

  // THE VERIFICATION HAS TO USE THE SAME CLASSIFIER.
  // styleOfUrl answers null for an Amazon search URL, so a search link that
  // failed to convert would be invisible to the after-the-write check and the
  // post would be reported clean with the sticky mobile button still plain.
  check('the leftovers check uses the conversion classifier',
    /const leftovers = convertibleLinks\(updated, chosenStyle\)/.test(route),
    'checking with styleOfUrl would make a failed search-link conversion invisible, which is the exact reporting failure this fixes')

  check('the result line names the extra links', /extraLinksConverted/.test(route) && /extraLinks/.test(ui),
    'a count nothing renders is the same as not counting it')
  check('and the creator is told what they were',
    /sticky mobile button/i.test(ui),
    'the one they reported as the most important miss')
}

if (failures.length) {
  console.error(`\n❌ post-affiliate-links: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ post-affiliate-links: every tagged link is converted, deduped by destination, and untagged pages are left alone')
