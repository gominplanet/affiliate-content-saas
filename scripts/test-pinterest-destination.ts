// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The one rule Pinterest enforces and MVP was breaking in one of two places.
//
// A Deal Radar push came back with "Sorry! We blocked this link because it may
// lead to spam" on Pinterest alone, while every other platform in the same run
// posted fine. The pin pointed at an mvpl.ink Passport link.
//
// MVP already had the rule written down, in the OTHER Pinterest path:
// "NEVER an affiliate redirect — Pinterest + Amazon ToS; every option here is
// the creator's own page". Two paths, opposite behaviour, and only the wrong
// one reached Pinterest.
//
// So the test is not "does it pick a URL". It is: can an affiliate redirect
// EVER come out of this, by any route, including the fallbacks.
import { readFileSync } from 'node:fs'
import { pinDestination, isBlockedPinLink, choosePinDestination, amazonPinUrl, productPageUrl, pinterestClaimCode, withClaimTag, claimCodeIn } from '../lib/pinterest-destination'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const APP = 'https://www.mvpaffiliate.io'

// ── the Deal Radar case: no blog post will ever exist ───────────────────────
{
  const d = pinDestination({ shopHandle: 'lisa', appOrigin: APP })
  check('a deal push points at the shop page', d.url === 'https://www.mvpaffiliate.io/shop/lisa', d.url ?? 'null')
  check('and is labelled as such', d.kind === 'shop')
  check('and the creator is told why, not left guessing',
    /does not allow affiliate redirect links/.test(d.note || ''), d.note || 'null')
  check('and told the product is actually on that page',
    /product is on that page/.test(d.note || ''), d.note || 'null')

  check('a leading @ on the handle is not doubled up',
    pinDestination({ shopHandle: '@lisa', appOrigin: APP }).url === 'https://www.mvpaffiliate.io/shop/lisa')
  check('a trailing slash on the origin does not double up',
    pinDestination({ shopHandle: 'lisa', appOrigin: 'https://x.io/' }).url === 'https://x.io/shop/lisa')
  check('a handle with regrettable characters is encoded',
    pinDestination({ shopHandle: 'a b', appOrigin: APP }).url === 'https://www.mvpaffiliate.io/shop/a%20b')
}

// ── a post about this exact product beats a grid containing it ─────────────
{
  const d = pinDestination({ blogPostUrl: 'https://mine.com/review', shopHandle: 'lisa', appOrigin: APP })
  check('the blog post wins when there is one', d.url === 'https://mine.com/review' && d.kind === 'blog_post')
  check('and needs no explanation', d.note === null, 'this is what a creator already expects a pin to do')
}

// ── the fallbacks, which are where an affiliate link would sneak back in ───
{
  const home = pinDestination({ homepageUrl: 'https://mine.com', appOrigin: APP })
  check('no shop page falls back to their own site', home.url === 'https://mine.com' && home.kind === 'homepage')
  check('and says how to do better', /Set up your Link in Bio/.test(home.note || ''), home.note || 'null')

  const none = pinDestination({ appOrigin: APP })
  check('nothing to point at means NO pin, not an affiliate link',
    none.url === null && none.kind === 'none',
    'publishing a pin we know will be rejected, then showing the creator Pinterest\'s spam wording, blames them for our gap')
  check('and it explains what to set up', /Link in Bio/.test(none.note || ''), none.note || 'null')

  // ── the fix is offered, not just described ────────────────────────────────
  // A sentence telling someone to go and make a page, with no way to get there,
  // is a dead end dressed up as help.
  check('the no-page case is flagged so the UI can offer a button',
    none.needsLinkPage === true && none.setupPath === '/link-in-bio',
    JSON.stringify({ needsLinkPage: none.needsLinkPage, setupPath: none.setupPath }))
  check('and so is the homepage fallback, where a page would be an upgrade',
    home.needsLinkPage === true && home.setupPath === '/link-in-bio')
  check('but a working shop page prompts nothing',
    pinDestination({ shopHandle: 'lisa', appOrigin: APP }).needsLinkPage !== true)
  check('and neither does a blog post',
    pinDestination({ blogPostUrl: 'https://mine.com/p', appOrigin: APP }).needsLinkPage !== true)
}

// ── junk in the inputs must not become a destination ────────────────────────
{
  for (const bad of ['', '   ', 'not a url', 'javascript:alert(1)', 'ftp://x.com/a']) {
    const d = pinDestination({ blogPostUrl: bad, homepageUrl: bad, appOrigin: APP })
    check(`a malformed URL is not used: ${JSON.stringify(bad)}`, d.url === null, d.url ?? 'null')
  }
}

// ── the guard: an affiliate redirect must never reach Pinterest ────────────
// Whatever route assembles the pin, this is the last thing that looks at it.
{
  for (const blocked of [
    'https://www.mvpl.ink/ab3xy9k',
    'https://mvpl.ink/ab3xy9k',
    'https://geni.us/cXNSl',
    'https://bit.ly/3xyz',
    'https://amzn.to/3abc',
    'https://a.co/d/xyz',
    'https://tinyurl.com/abc',
    'https://www.mvpaffiliate.io/go/ab3xy9k',
  ]) {
    check(`blocked: ${blocked}`, isBlockedPinLink(blocked), 'this is what Pinterest rejected')
  }
  for (const allowed of [
    'https://www.mvpaffiliate.io/shop/lisa',
    'https://mine.com/review',
    'https://mine.com',
    'https://www.amazon.com/dp/B0H298X69Z?tag=x-20',
    '',
    null,
  ]) {
    check(`allowed: ${allowed ?? '(null)'}`, !isBlockedPinLink(allowed), 'a real page must still be pinnable')
  }
  // The shop page lives on the same domain as the /go/ redirect. If the guard
  // matched the domain rather than the path, it would block the very page this
  // whole change exists to point at.
  check('the shop page is not confused with the redirect on the same domain',
    !isBlockedPinLink('https://www.mvpaffiliate.io/shop/lisa')
    && isBlockedPinLink('https://www.mvpaffiliate.io/go/abc123'))
}

// ── no route through this function returns something Pinterest blocks ──────
// Stated as an invariant rather than case by case, because the failure mode is
// a future edit adding a fallback that reaches for the affiliate link again.
{
  const inputs = [
    { shopHandle: 'lisa' },
    { blogPostUrl: 'https://mine.com/p' },
    { homepageUrl: 'https://mine.com' },
    { shopHandle: 'lisa', blogPostUrl: 'https://mine.com/p', homepageUrl: 'https://mine.com' },
    {},
    { shopHandle: '', blogPostUrl: '', homepageUrl: '' },
  ]
  for (const i of inputs) {
    const d = pinDestination({ ...i, appOrigin: APP })
    check(`never returns a blocked link: ${JSON.stringify(i)}`,
      !isBlockedPinLink(d.url), d.url ?? 'null')
    check(`and always explains itself when it is not the obvious answer: ${JSON.stringify(i)}`,
      d.kind === 'blog_post' ? d.note === null : d.note !== null)
  }
}

// ── the blog pin "Product link" never carries a short or redirect link ──────
//
// It used to return the creator's Passport link first (mvpl.ink), then
// Geniuslink or Bitly, and publishPinForPost wrapped it again in geni.us. Every
// one of those is a link Pinterest can reject as spam, and a rejection counts
// against the domain every creator's links share.
{

  const R = readFileSync('lib/pin-product-link.ts', 'utf8').replace(/^\s*\/\/.*$/gm, '')
  check('the pin product link never makes a Passport, Geniuslink or Bitly link',
    !/passportLinkFor|shortenBitly|getOrCreateAmazonGeniuslink/.test(R))
  check('a stored mvpl.ink link is unwrapped to the real product', /mvpl\\\.ink/.test(R))
  check('and a link that could not be unwrapped is not sent', /url: isBlockedPinLink\(dest\) \? null : dest/.test(R))
  const P = readFileSync('lib/pin-publish.ts', 'utf8')
  check('the product link is not wrapped in geni.us on the way out', /cfg\.style === 'geniuslink' && !useOverride/.test(P))
  check('and a blocked product link falls back to the blog post, or stops with a reason',
    /if \(useOverride && isBlockedPinLink\(destLink\) && /.test(P) && /which Pinterest blocks/.test(P))
}

// ── one setting for where product pins go (migration 382) ──────────────────
{
  const all = { blogPostUrl: 'https://blog.example/review', productPageUrl: 'https://www.mvpaffiliate.io/shop/seb/B000000001', amazonUrl: 'https://www.amazon.com/dp/B000000001?tag=seb-pin-20', homepageUrl: 'https://blog.example' }
  check('Automatic goes blog post, then Link in Bio product page, then Amazon, then homepage',
    choosePinDestination({ pref: 'auto', ...all }).kind === 'blog_post'
    && choosePinDestination({ pref: 'auto', ...all, blogPostUrl: null }).kind === 'product_page'
    && choosePinDestination({ pref: 'auto', ...all, blogPostUrl: null, productPageUrl: null }).kind === 'amazon'
    && choosePinDestination({ pref: 'auto', homepageUrl: all.homepageUrl }).kind === 'homepage')
  check('the creator\'s choice wins when it is available, with no note',
    choosePinDestination({ pref: 'amazon', ...all }).kind === 'amazon' && choosePinDestination({ pref: 'amazon', ...all }).note === null
    && choosePinDestination({ pref: 'link_in_bio', ...all }).kind === 'product_page')
  const fell = choosePinDestination({ pref: 'blog_post', ...all, blogPostUrl: null })
  check('a choice that is not available falls through and says why', fell.kind === 'product_page' && /no blog post about this product yet/.test(fell.note || ''))
  check('a redirect is never chosen, whatever it was offered as',
    choosePinDestination({ pref: 'amazon', amazonUrl: 'https://amzn.to/x', productPageUrl: 'https://www.mvpl.ink/abcd' }).kind === 'none')
  check('nothing available is said plainly', /no blog post, no published Link in Bio page, and no Amazon tag/.test(choosePinDestination({ pref: 'auto' }).note || ''))
  check('the Amazon pin link is the full tagged amazon.com link, and needs a tag',
    amazonPinUrl('b000000001', 'seb-pin-20') === 'https://www.amazon.com/dp/B000000001?tag=seb-pin-20' && amazonPinUrl('B000000001', '') === null && !isBlockedPinLink(amazonPinUrl('B000000001', 't-20')))
  check('the product page lives under the shop handle', productPageUrl('https://www.mvpaffiliate.io/', 'seb', 'b000000001') === 'https://www.mvpaffiliate.io/shop/seb/B000000001')
  const code = '5e1f4647f3b22f7c34b62e98e2ece410'
  check('the claim code is read from the bare code or the whole tag', pinterestClaimCode(code) === code && pinterestClaimCode(`<meta name="p:domain_verify" content="${code.toUpperCase()}"/>`) === code && pinterestClaimCode('nope') === null)
  const tags = withClaimTag(['<meta name="google-site-verification" content="g"/>', '<meta name="p:domain_verify" content="old"/>'], code)
  check('setting the claim code replaces the old one and keeps the other tags',
    tags.length === 2 && tags[0].includes('google-site-verification') && claimCodeIn(tags) === code && withClaimTag(tags, null).length === 1)

  const PUB = readFileSync('lib/amazon-pin-publish.ts', 'utf8')
  check('product and deal pins follow the setting', /pref: opts\.prefOverride \?\? settings\.pref/.test(PUB) && /choosePinDestination\(\{/.test(PUB) && !/\bpinDestination\(\{/.test(PUB))
  check('the product page is offered only once the product is on the page', /productPageUrl: shopHandle && opts\.asin \? productPageUrl\(origin, shopHandle, opts\.asin\) : null/.test(PUB) && /if \(tileError\) shopHandle = null/.test(PUB))
  check('blog pins follow the setting, per pin and when scheduled',
    /blogPinLink\(supabase, user\.id, p, decIg, target\)/.test(readFileSync('app/api/blog/pinterest-post/route.ts', 'utf8'))
    && /blogPinLink\(admin,[\s\S]{0,120}?'default'\)/.test(readFileSync('app/api/cron/process-scheduled/route.ts', 'utf8')))
  check('the Pinterest tracking ID is used on direct Amazon pins', /settings\.pinterestTag \|\| \(ig\?\.amazon_associates_tag/.test(readFileSync('lib/pin-product-link.ts', 'utf8')) && /amazonTag: pinterestTag \|\|/.test(readFileSync('lib/pinterest-pin-dest-server.ts', 'utf8')))
  check('video pins refuse a redirect too', /if \(rawLink && isBlockedPinLink\(rawLink\)\)/.test(readFileSync('app/api/pinterest/video-pin/route.ts', 'utf8')))
  const PAGE = readFileSync('app/shop/[handle]/[asin]/page.tsx', 'utf8')
  check('the product page buys through the same click counter, and sends a gone product to the shop',
    /href=\{`\/api\/link-click\?i=\$\{item\.id\}`\}/.test(PAGE) && /if \(!data\.item\) redirect\(/.test(PAGE) && /images: shopTileImage\(data\.item\.image_url, data\.item\.asin\)/.test(PAGE))
  check('a shopper who is not logged in can use the buy buttons', /'\/api\/link-click',/.test(readFileSync('middleware.ts', 'utf8')))
  const PICK = readFileSync('components/pinterest/PinDestinationPicker.tsx', 'utf8')
  check('the picker opens on the saved choice and saves a change at once, putting it back when the save failed',
    /fetch\('\/api\/pinterest\/settings'\)\.then/.test(PICK) && /body: JSON\.stringify\(\{ pref: next \}\)/.test(PICK) && /setValue\(prev\)/.test(PICK))
  for (const f of ['components/deal/QuickPostModal.tsx', 'components/amazon/PinterestComposer.tsx']) {
    const src = readFileSync(f, 'utf8')
    check(`${f}: "Pin links to" is right in the window, and posting waits for the choice to save`,
      /<PinDestinationPicker onBusy=\{setPinDestSaving\} \/>/.test(src) && /pinDestSaving \|\|/.test(src))
  }
  check('the composer no longer says the affiliate link is the pin\'s destination',
    !/Your affiliate link is attached to the Pin automatically/.test(readFileSync('components/amazon/PinterestComposer.tsx', 'utf8')))
  check('the setting has its migration', /check \(pinterest_product_dest in \('auto', 'blog_post', 'link_in_bio', 'amazon'\)\)/.test(readFileSync('supabase/migrations/382_pinterest_product_dest.sql', 'utf8')))
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
