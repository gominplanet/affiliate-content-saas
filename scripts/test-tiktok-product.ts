// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE NUMBERS ON A TIKTOK PRODUCT CARD BELONG TO THAT PRODUCT.
//
// Run against the REAL page, saved verbatim as a gzipped fixture, because
// every trap on it produces a plausible wrong answer and a hand-written
// fixture would only contain the traps I already knew about.
//
// The page is shop.tiktok.com/us/pdp/1731742332894876359, an Enya travel
// guitar on @gominreviews' showcase. Truth, read off the rendered page in a
// real browser: $279.99, rated 4.7 from 277 reviews, 2,883 sold, sold by
// ENYAMUSICOfficialFlagship.
//
// THE THREE TRAPS. Each returns a number that looks like an answer:
//
//   shop_rating: "4.7"        the SELLER's rating, and on this page it is
//                             IDENTICAL to the product's. A parser that reads
//                             it passes every test anyone would think to write
//                             and stays wrong until a good seller lists a bad
//                             product. There is no way to catch that from the
//                             value, so the test checks the SOURCE.
//
//   shop_info.sold_count: 6688  the seller's lifetime total. The product sold
//                             2883. Both integers, both plausible. On THIS page
//                             the product's happens to appear first, so an
//                             unscoped read gets the right answer by luck of
//                             ordering and the value cannot tell them apart.
//                             Document order is not a contract, so the check
//                             below is on the SOURCE, same as the rating.
//
//   review_count: 624         the shop's, next to the product's 277. And the
//                             recommendations carousel below carries more
//                             products with a full set of their own fields.
//
// So the rule the parser implements, and the rule this file exists to hold:
// every product-level number is read from the one object carrying the matching
// product_id, never from the first match in the document.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import {
  parseTikTokProduct, tiktokProductIdFromUrl, isTikTokProductUrl,
  tiktokRegionFromUrl, upgradeTikTokImage,
} from '../lib/tiktok-product'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const URL = 'https://shop.tiktok.com/us/pdp/1731742332894876359?_t=ZP-99llPF8i4T8'
const HTML = gunzipSync(readFileSync('scripts/fixtures/tiktok-pdp-1731742332894876359.html.gz')).toString('utf8')

// ── the fixture is the real page, not a convenient one ─────────────────────
{
  check('the fixture survived the round trip', HTML.length > 250_000, `${HTML.length} bytes`)
  check('and still contains the seller-rating trap', /"shop_rating":"4\.7"/.test(HTML),
    'if this drops out of the fixture, the most dangerous check below is testing nothing')
  check('and the shop sold-count trap', /"sold_count":6688/.test(HTML))
  check('and the shop review-count trap', /"review_count":624/.test(HTML))
  check('and a second product from the carousel', (HTML.match(/"product_id":"\d+"/g) || []).length > 5,
    'an unscoped read has to have something wrong to grab')
}

// ── which links are product links ──────────────────────────────────────────
{
  check('a product URL yields its id', tiktokProductIdFromUrl(URL) === '1731742332894876359')
  check('the query string is irrelevant',
    tiktokProductIdFromUrl('https://shop.tiktok.com/us/pdp/1731742332894876359') === '1731742332894876359')
  check('the bare /pdp/ spelling works',
    tiktokProductIdFromUrl('https://shop.tiktok.com/pdp/1731742332894876359') === '1731742332894876359')
  check('a bare host gets a scheme', isTikTokProductUrl('shop.tiktok.com/us/pdp/1731742332894876359'))
  check('the region is read', tiktokRegionFromUrl(URL) === 'us')

  // Everything that is NOT a product link. Each of these was accepted by the
  // showcase-destination host check at some point, which is why they are here.
  check('a SHOWCASE share link is not a product',
    !isTikTokProductUrl('https://vt.tiktok.com/ZTUbdCWjq/?page=TikTokShop'),
    'it resolves to an app scheme and has no product id at all')
  check('a profile is not a product', !isTikTokProductUrl('https://www.tiktok.com/@gominreviews'))
  check('a video is not a product', !isTikTokProductUrl('https://www.tiktok.com/@x/video/7412345678901234567'))
  check('http is refused', !isTikTokProductUrl('http://shop.tiktok.com/us/pdp/1731742332894876359'))
  check('a lookalike host is refused', !isTikTokProductUrl('https://shop.tiktok.com.evil.co/us/pdp/1731742332894876359'),
    'suffix matching has to be anchored or any host ending in the right letters passes')
  check('another site is refused', !isTikTokProductUrl('https://example.com/us/pdp/1731742332894876359'))
  check('empty is refused', !isTikTokProductUrl('') && !isTikTokProductUrl(null))
}

// ── the parse, against the real page ───────────────────────────────────────
const p = parseTikTokProduct(HTML, URL)
{
  check('the page parses at all', !!p)
  if (!p) {
    console.error('\n❌ tiktok-product: the fixture did not parse; nothing below ran\n')
    process.exit(1)
  }
  check('the id comes from the URL', p.productId === '1731742332894876359')
  check('the title is the full product name',
    p.title.startsWith('Enya NOVA GO SP1 Carbon Fiber Travel Guitar Kit') && p.title.length > 150,
    `${p.title.length} chars: ${p.title.slice(0, 60)}`)
  check('the description is real marketing copy',
    p.description.includes('carbon fiber travel guitar') && p.description.length > 80,
    p.description.slice(0, 70))
  check('the price is the buyer price', p.price === '279.99', String(p.price))
  check('the currency is carried', p.currency === 'USD' && p.currencySymbol === '$',
    `${p.currency} ${p.currencySymbol}`)
  check('the seller is named', p.sellerName === 'ENYAMUSICOfficialFlagship', String(p.sellerName))
  check('the region is carried', p.region === 'us')
}

// ── THE TRAPS ──────────────────────────────────────────────────────────────
{
  check('the rating is the PRODUCT rating', p.rating === 4.7, String(p.rating))
  // The value cannot prove this: shop_rating is ALSO 4.7 on this page. So the
  // source is checked instead. A parser reading the seller's rating would pass
  // the line above and fail this one.
  const LIB = readFileSync('lib/tiktok-product.ts', 'utf8')
  const code = LIB.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  check('and it is read from review_ratings, not shop_rating',
    /review_ratings/.test(code) && !/["']shop_rating["']/.test(code),
    'shop_rating is 4.7 on this page too, so only the source tells the two apart')

  check('the review count is the PRODUCT count', p.reviewCount === 277,
    `${p.reviewCount}; the shop's 624 sits beside it`)
  check('the sold count is the PRODUCT count', p.soldCount === 2883,
    `${p.soldCount}; the shop's lifetime total of 6688 is the wrong answer here`)
  check('and it is emphatically not the shop total', p.soldCount !== 6688)

  check('the scope helper exists', /function productScoped/.test(code))
  check('and is anchored on the product id', /"product_id":"\$\{productId\}"/.test(code))
  // PER FIELD, because a file can contain productScoped and still not use it
  // for the field that matters. Both of these returned the correct value on
  // this fixture when read unscoped, purely because of where they sit in the
  // document, so the value proves nothing and only the call site does.
  for (const field of ['sold_count', 'sale_price_decimal', 'currency_name']) {
    check(`${field} is read through productScoped`,
      new RegExp(`productScoped\\(html, productId, '${field}'\\)`).test(code),
      'an unscoped read returns a real number belonging to the carousel or the shop')
  }
  check('nothing reads a bare sold_count off the document',
    !/html\.match\([^)]*sold_count/.test(code))
  check('nor a bare sale_price',
    !/html\.match\([^)]*sale_price/.test(code))
}

// ── the image is usable, not a 260px thumbnail ─────────────────────────────
{
  check('og:image is upgraded', /resize-webp:1200:1200/.test(p.imageUrl || ''), String(p.imageUrl).slice(0, 90))
  check('and it is still the same image', /b9f44ae9ec3244848e06056d92100879/.test(p.imageUrl || ''),
    'rewriting the size must not rewrite the object')
  check('the CDN query survives', /idc=useast8/.test(p.imageUrl || ''),
    'those parameters are part of the signed URL; dropping them 400s')
  check('a custom size is honoured', /resize-webp:800:800/.test(upgradeTikTokImage(p.imageUrl, 800) || ''))
  check('a silly size is clamped', /resize-webp:2000:2000/.test(upgradeTikTokImage(p.imageUrl, 99999) || ''))
  check('a URL with no transform is left alone',
    upgradeTikTokImage('https://example.com/a.jpg') === 'https://example.com/a.jpg',
    'a URL we do not recognise is likelier to break than to improve')
  check('empty in, null out', upgradeTikTokImage('') === null && upgradeTikTokImage(null) === null)
}

// ── refusing is better than inventing ──────────────────────────────────────
{
  check('a non-product URL parses to null', parseTikTokProduct(HTML, 'https://example.com/x') === null,
    'without a product id there is no way to tell this product from the carousel')
  check('an empty page parses to null', parseTikTokProduct('', URL) === null)
  check('a page with no title parses to null', parseTikTokProduct('<html><body>nope</body></html>', URL) === null,
    'a record of nulls saved under a real id is worse than a refusal')
}

// ── a TikTok product must never reach the Amazon price paths ───────────────
//
// There is ONE price on the page and no history for it, so "lowest we have
// seen" and the Deal check block have nothing to stand on. The showcase
// destination work already suppresses Amazon claims; this keeps the product
// side honest about why.
{
  const LIB = readFileSync('lib/tiktok-product.ts', 'utf8')
  check('the module says there is no price history', /no price history|no past for it/i.test(LIB),
    'the next person to wire this into Deals needs to know before they try')
}

// ── the wiring: Labs-gated, pasted link preserved, migration reported ──────
//
// The route's job is not only to read the page. Three things here are the
// difference between a feature and a support thread:
//
//   the pasted link is stored verbatim (it carries the attribution),
//   a missing table reads as "run migration 334" and not as a 500,
//   and "read it but could not save it" is NOT reported as a bad link.
{
  const ROUTE = readFileSync('app/api/labs/tiktok-shop/resolve/route.ts', 'utf8')
  const rcode = ROUTE.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  check('the route is Labs gated', /canSeeNav\('labs', tier\)/.test(rcode),
    'a Pro-only nav entry with an open route is not gated at all')
  check('the PASTED url is what gets saved', /share_url: pasted/.test(rcode),
    'the _t and u_code parameters are what credit the sale; a normalized link strips them')
  check('and the canonical url is kept apart', /canonical_url: canonicalUrl/.test(rcode),
    'it exists to re-read the page, and must never be the thing published')
  check('the pasted url is what we FETCH too', /fetchWithTimeout\(pasted/.test(rcode),
    'reading the canonical URL would follow a different path than a real visitor')
  check('the fetch has a deadline', /timeoutMs: DEFAULT_TIMEOUT_MS/.test(rcode),
    'Node fetch has no default timeout and this route runs on a creator watching a spinner')
  check('a missing table names the migration', /334_tiktok_products/.test(ROUTE),
    'Seb runs SQL by pasting it; "relation does not exist" sends him nowhere')
  check('a page that is not a product is refused, not saved',
    /could not read a product from it/.test(ROUTE),
    'a row of nulls under a real id looks fine on the list and produces an empty post later')
  check('a read that could not save says which half failed',
    /read the product but could not save it|read the product, but your database/.test(ROUTE),
    'reporting it as a bad link sends the creator back to TikTok for a link that was fine')
  check('the list select is not column-named', /select\('\*'\)/.test(rcode),
    'PostgREST rejects the whole statement over one missing column, so naming them turns a schema drift into an empty page')

  const UI = readFileSync('components/labs/TikTokShop.tsx', 'utf8')
  check('the screen says there is no bulk import', /no bulk import/i.test(UI),
    'otherwise the first minute is spent hunting for an Import All that cannot exist')
  check('and tells the creator their link is published as pasted',
    /exact link you paste/i.test(UI),
    'one sentence here is cheaper than a support thread about a missing commission')
  check('a missing price is not a blank', /Price not listed/.test(UI),
    'an empty slot where a price goes reads as free')
  check('the add error is held on screen', /const \[addError, setAddError\]/.test(UI),
    'a toast is gone before they have gone back to TikTok for another link')

  const NAV = readFileSync('components/layout/DashboardShellV2.tsx', 'utf8')
  check('it sits in Labs and is Pro-gated',
    /href: '\/tiktok-shop'[\s\S]{0,140}?gate: isPro/.test(NAV))
  const labsAt = NAV.indexOf("label: 'Labs'")
  const itemAt = NAV.indexOf("href: '/tiktok-shop'")
  check('and the nav entry is inside the Labs group', labsAt > -1 && itemAt > labsAt,
    'above Labs it would be promoted as a finished feature')
}

if (failures.length) {
  console.error(`\n❌ tiktok-product: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ tiktok-product: a product link resolves to that product’s own title, price, rating, reviews and units sold, never the seller’s and never the carousel’s')
