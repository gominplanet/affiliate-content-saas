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
import {
  normalizeOwnership, ownershipDisclosure, ownershipVoiceRule, hasHandsOn,
  DEFAULT_OWNERSHIP, OWNERSHIP_CHOICES,
} from '../lib/product-ownership'
import { scrubReviewLanguage, DEAL_VOICE_RULES } from '../lib/deal-scrub'

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
  check('og:image is upgraded to 1200', /resize-jpeg:1200:1200/.test(p.imageUrl || ''), String(p.imageUrl).slice(0, 90))
  check('and asks for JPEG, not WebP', /\.jpeg/.test(p.imageUrl || '') && !/webp/.test(p.imageUrl || ''),
    'WordPress refused a .jpg carrying WebP bytes and the first post shipped with no featured image')
  check('and it is still the same image', /b9f44ae9ec3244848e06056d92100879/.test(p.imageUrl || ''),
    'rewriting the size must not rewrite the object')
  check('the CDN query survives', /idc=useast8/.test(p.imageUrl || ''),
    'those parameters are part of the signed URL; dropping them 400s')
  check('a custom size is honoured', /resize-jpeg:800:800/.test(upgradeTikTokImage(p.imageUrl, 800) || ''))
  check('a silly size is clamped', /resize-jpeg:2000:2000/.test(upgradeTikTokImage(p.imageUrl, 99999) || ''))
  check('re-upgrading an upgraded url is a no-op',
    upgradeTikTokImage(upgradeTikTokImage(p.imageUrl)) === upgradeTikTokImage(p.imageUrl),
    'the blog route re-runs it over stored rows to repair them, so it must not erode')
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
  check('the route is pinned to a TikTok Shop region', /preferredRegion = 'iad1'/.test(rcode),
    'nothing in vercel.json pins one, so without this the feature depends on a project setting nobody would connect to TikTok')
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

// ── a blog post about a TikTok product ─────────────────────────────────────
//
// blog/from-link already wrote about "any store/affiliate link", but every
// branch in it assumed Amazon underneath: an ASIN to geo-route, an Associates
// tag to append, and a disclosure naming a programme this post does not earn
// through. A TikTok Shop product has none of those, and the ways that go wrong
// are all quiet ones.
{
  const FL = readFileSync('app/api/blog/from-link/route.ts', 'utf8')
  const fl = FL.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  check('the route accepts a saved product', /tiktokProductId/.test(fl))
  check('and the product is looked up under the OWNER', /\.eq\('user_id', ownerId\)\.eq\('product_id', tiktokProductId\)/.test(fl),
    'without the user_id filter any creator could write a post about any other creator\'s product')
  check('an unknown product is refused, not written around',
    /not in your saved products/.test(FL),
    'falling through would write a post with no destination at all')

  check('the TikTok branch is checked BEFORE the Amazon one',
    fl.indexOf('if (tiktokProductId)') > -1 && fl.indexOf('if (tiktokProductId)') < fl.indexOf('} else if (asin)'),
    'none of the Amazon machinery applies, so it must not be the default path')
  check('and the Amazon branch became an else',
    /\} else if \(asin\) \{/.test(fl),
    'left as a separate if, both would run and the second would overwrite the destination')

  check('the destination is the saved share_url', /tp\.share_url as string/.test(fl),
    'it carries _t and u_code, which is what credits the sale')
  check('and it goes through the per-product resolver', /resolveProductShopLink\(supabase, ownerId, tp\.share_url/.test(fl),
    'that is what wraps it for click tracking without rewriting it')
  // The resolver's RESULT has to be what ships. Keeping the call and throwing
  // away its return leaves both checks above satisfied and still publishes the
  // wrong link, which is precisely the attribution-stripping bug.
  check('and the resolver\'s result is what becomes the link',
    /affiliateUrl = shop\?\.url \?\? \(tp\.share_url as string\)/.test(fl),
    'a call whose return is discarded is not a call')
  check('canonical_url is never a destination', !/affiliateUrl = .*canonical_url/.test(fl),
    'it exists to re-read the product page and carries none of the share attribution')

  check('a swapped link style is reported', /linkNote: tiktokNote/.test(fl),
    'a Geniuslink creator silently getting a Passport link is a change they should hear about')

  check('the Associates disclosure is NOT used on a TikTok post',
    /tiktokProductId\s*\n?\s*\? SHOWCASE_DISCLAIMER/.test(fl),
    'the post does not earn through Amazon Associates and the Operating Agreement is not a thing to be casually wrong about')
  check('but the creator\'s own disclaimer still wins',
    /brand\?\.affiliate_disclaimer as string\) \|\| \(tiktokProductId/.test(fl),
    'they wrote it, so it is not ours to override')

  check('a product with no link is still researchable',
    /const target = finalUrl \|\| link \|\| productName/.test(fl),
    'there is no page to fetch, so without the name the post is written from a title alone and invents the specifics')
  check('and a saved product alone is enough to start',
    /!link && !providedName && !tiktokProductId/.test(fl),
    'the product carries its own name; demanding a link too would block the one path that has everything')

  // ── the post has a picture, or says why not ─────────────────────────────
  //
  // The first post this feature published had NO featured image and no
  // og:image, and reported "Published." Three separate attempts at a hero ran
  // and all three failed quietly: one logged to console.warn, two had empty
  // catch blocks. On a post whose entire purpose is being pushed to Pinterest
  // and Facebook, no og:image means nothing to show.
  //
  // The cause was one character of mismatch. og:image is a WebP, and WordPress
  // was handed a file named "<slug>.jpg" carrying Content-Type: image/webp. The
  // same CDN object answers 200 as image/jpeg if the extension is .jpeg, so
  // asking for that is the whole fix.
  const LIBT = readFileSync('lib/tiktok-product.ts', 'utf8')
  check('the image is requested as JPEG', /resize-jpeg:\$\{n\}:\$\{n\}/.test(LIBT),
    'WordPress will not take a .jpg whose bytes are WebP, and the post ships with no picture')
  check('and the .webp extension is rewritten too', /\\.webp\(\?=\\\?\|\$\)/.test(LIBT) || /'\.jpeg'/.test(LIBT),
    'the CDN keys the format off the extension, not the transform alone')
  check('the upgrade is idempotent over jpeg', /resize-\(\?:webp\|jpeg\|image\)/.test(LIBT),
    'a product saved before this fix still holds a WebP, and re-running must repair it rather than no-op')

  check('the blog route re-upgrades the stored url', /upgradeTikTokImage\(tp\.image_url/.test(fl),
    'rows saved before the fix would otherwise keep failing forever')
  check('the hero note is kept, not only logged', /heroNote = designed\.note/.test(fl),
    'attachPostHero already explains what went wrong; console.warn is where that explanation went to die')
  const heroAssigns = (fl.match(/heroNote =/g) || []).length
  check('every image failure path records why', heroAssigns >= 3, `${heroAssigns} assignment(s)`)
  check('the generated-hero catch records', /catch \(e\) \{[\s\S]{0,200}?heroNote = heroNote \|\|/.test(fl),
    'an empty catch is how three separate failures became one silent success')
  check('and so does the WordPress upload catch',
    /uploadImageFromUrl\(productImageUrl[\s\S]{0,300}?catch \(e\) \{[\s\S]{0,160}?heroNote =/.test(fl),
    'this is the last of the three, so its silence is the one that ships the post')
  check('and a post with no image says so', /imageNote: featuredMedia \? null/.test(fl),
    'no og:image means a pin or a Facebook post from it comes out blank')

  const UI = readFileSync('components/labs/TikTokShop.tsx', 'utf8')
  check('the screen shows the image warning', /j\.imageNote/.test(UI))
  check('the card can start one', /tiktokProductId: p\.product_id/.test(UI))
  check('and says how long it takes', /takes a couple of minutes/.test(UI),
    'a silent two-minute wait reads as a hang')
  check('the spinner is on the product, not the page', /writing === p\.product_id/.test(UI),
    'a page-wide spinner hides which product is running')
  check('both notes reach the screen', /j\.note/.test(UI) && /j\.linkNote/.test(UI),
    'one means the post is live but unrecorded, the other means the link style changed; neither is a failure')
}

// ── did they actually use it, and how did they get it ──────────────────────
//
// The blog writer's prompt says "you are the creator writing a FIRST-PERSON
// affiliate review of ONE product — you personally recommend it", and the
// first post this feature published duly opened "I was super excited when the
// Enya NOVA GO SP1…". For most TikTok Shop affiliates that is true. For one
// who has not got the product it is fabricated experience, and the FTC's
// position is that you cannot endorse a product you have not used.
//
// THE OBVIOUS FIX IS THE WRONG ONE. Adding a fixed line to every post saying
// the review is based on the creator's own use is STRONGER than what the
// writer currently implies: it turns an implied claim into an explicit one, so
// on a post by a creator who has not used the product it upgrades a bad post
// into a false statement. Hence a per-product answer that changes the VOICE,
// not a sentence that papers over it.
{
  check('the default is bought', DEFAULT_OWNERSHIP === 'bought',
    'most of these creators have the product; defaulting to not-used would downgrade every existing row')
  check('an unknown value reads as the default', normalizeOwnership('nonsense') === 'bought'
    && normalizeOwnership(null) === 'bought' && normalizeOwnership('') === 'bought',
    'a creator who never saw the question must still get a working product')
  check('the three real values survive', normalizeOwnership('gifted') === 'gifted'
    && normalizeOwnership('not-used') === 'not-used' && normalizeOwnership('bought') === 'bought')
  check('every choice is offered on screen', OWNERSHIP_CHOICES.length === 3)

  check('bought adds NO disclosure', ownershipDisclosure('bought') === null,
    'buying it yourself is not a material connection, and asserting hands-on use would be us making the claim')
  check('gifted discloses the gift', /sent me this product/i.test(ownershipDisclosure('gifted') || ''),
    'a free sample is a material connection and "contains affiliate links" says nothing about it')
  check('and says the brand did not control the post', /did not pay for or approve/i.test(ownershipDisclosure('gifted') || ''))
  check('not-used says so plainly', /have not used this one myself/i.test(ownershipDisclosure('not-used') || ''))

  check('only not-used changes the voice',
    ownershipVoiceRule('bought', DEAL_VOICE_RULES) === null
    && ownershipVoiceRule('gifted', DEAL_VOICE_RULES) === null
    && ownershipVoiceRule('not-used', DEAL_VOICE_RULES) === DEAL_VOICE_RULES,
    'a creator who HAS the product should keep the review voice; that is the common case')
  check('hands-on tracks the same split',
    hasHandsOn('bought') && hasHandsOn('gifted') && !hasHandsOn('not-used'))
}

// ── the prompt rule is not the guard ───────────────────────────────────────
//
// Every other ban in this codebase learned this: a model told not to say
// something says it anyway often enough that scrubBanned exists at all. So the
// not-used case rewrites the OUTPUT too.
{
  const FL3 = readFileSync('app/api/blog/from-link/route.ts', 'utf8')
  const f3 = FL3.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  check('the voice rule reaches the prompt', /voiceRule \? `\$\{voiceRule\}/.test(f3))
  check('AND the output is scrubbed', /stripHandsOn \? scrubReviewLanguage\(cleaned\)/.test(f3),
    'a prompt rule alone has never held for any other ban in this codebase')
  check('the scrub runs at the one chokepoint', /const scrub = \(s: string\) => \{/.test(f3),
    'every piece of copy in the post goes through scrub(); anything else leaves gaps')
  check('and only when they have not used it', /const stripHandsOn = !!tiktokProductId && !hasHandsOn\(ownership\)/.test(f3),
    'rewriting a real owner\'s "I tested this" would be MVP inventing a limitation they do not have')

  check('the two disclosures are separate sentences', /\[scrub\(disclaimer\), ownLine \? scrub\(ownLine\) : ''\]/.test(f3),
    'one discloses a commission and the other a gift; a reader is entitled to both')
  check('and the ownership line is TikTok-only', /tiktokProductId \? ownershipDisclosure\(ownership\) : null/.test(f3),
    'an Amazon post has its own disclosure and this must not leak into it')

  // The scrub itself. DEAL_VOICE_RULES names both of these explicitly and the
  // patterns caught neither in its bare form, on the deal path as well.
  check('"in my experience" is rewritten',
    !/in my experience/i.test(scrubReviewLanguage('In my experience the battery lasts all day.')),
    'DEAL_VOICE_RULES bans it by name and only the "with this" form was caught')
  check('and keeps its sentence-start capital',
    /^From what owners report/.test(scrubReviewLanguage('In my experience the battery lasts all day.')),
    'every other rewrite starts with "I", so this is the first one whose case shows')
  check('"I bought one" is rewritten',
    !/I bought one/i.test(scrubReviewLanguage('I bought one and it has been fine.')),
    'only "I bought this/it/the X" was caught')
  check('the specific rules still win over the new catch-alls',
    scrubReviewLanguage('In my experience with this, the battery lasts.').startsWith('with this'),
    'the bare patterns are placed last for exactly this reason')
  check('and unrelated copy is not mangled',
    scrubReviewLanguage('I have owned three cars and none were this loud.')
      === 'I have owned three cars and none were this loud.',
    'too aggressive a rewrite breaks copy, which is why the possessive rules are narrow')
}

// ── the answer is askable and changeable ───────────────────────────────────
{
  const RT = readFileSync('app/api/labs/tiktok-shop/resolve/route.ts', 'utf8')
  check('the add route stores it', /ownership,/.test(RT))
  check('and normalizes rather than rejecting', /normalizeOwnership\(body\.ownership\)/.test(RT),
    'failing the add over an unrecognised value would break the one path that works')
  check('it can be changed later', /export async function PATCH/.test(RT),
    'the answer is often known after the product is added, not at the moment of pasting')
  check('the change is scoped to the owner', /\.eq\('id', id\)\.eq\('user_id', g\.user!\.id\)/.test(RT))
  check('a missing column names migration 335', /335_tiktok_product_ownership/.test(RT),
    'Seb runs SQL by pasting it; "column does not exist" sends him nowhere')

  const UI2 = readFileSync('components/labs/TikTokShop.tsx', 'utf8')
  check('the question is on the add form', /OWNERSHIP_CHOICES\.map/.test(UI2))
  check('and on every card afterwards', /setOwn\(p, e\.target\.value/.test(UI2))
  check('an optimistic change reverts on failure', /ownership: before/.test(UI2),
    'a control that silently keeps the wrong value is worse than a slow one')
}

if (failures.length) {
  console.error(`\n❌ tiktok-product: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ tiktok-product: a product link resolves to that product’s own title, price, rating, reviews and units sold, never the seller’s and never the carousel’s')
