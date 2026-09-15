// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Sending a post's clicks somewhere that is NOT Amazon.
//
// A creator who sells through their TikTok Shop can turn the affiliate link off
// on a post and point it at their own showcase instead. That is a DESTINATION
// change, not a fifth link style, and almost every way to get it wrong produces
// a post that looks perfectly correct on screen:
//
//   - hand Passport the ASIN and every click geo-routes to Amazon anyway
//   - leave Geniuslink on and the link is broken or points at Amazon
//   - keep the Amazon price claims and the post advertises a discount at a shop
//     the reader is never sent to
//   - keep the Associates disclosure and it states, untruthfully, that the
//     money comes from the Amazon Associates programme
//   - wrap the showcase in Passport for a PIN and Pinterest refuses it outright,
//     because mvpl.ink is on its own blocked-domain list
//
// Every one of those is silent. So this file is mostly about the four ways a
// showcase post can quietly become an Amazon post.
import { readFileSync } from 'node:fs'
import {
  resolvePostDestination, isTikTokShowcaseUrl, normalizeShowcaseUrl,
  styleForDestination, styleSwapNote, disclaimerForDestination,
  amazonDestination, SHOWCASE_DISCLAIMER,
} from '../lib/post-destination'
import { isBlockedPinLink } from '../lib/pinterest-destination'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const ASIN = 'B0GQGTXV2G'
const SHOWCASE = 'https://www.tiktok.com/@gominreviews/showcase'
const base = { asin: ASIN, amazonTag: 'gomin-20' }

// ── what counts as a showcase link ──────────────────────────────────────────
{
  check('a real showcase URL is accepted', isTikTokShowcaseUrl(SHOWCASE))
  check('a shop subdomain is accepted', isTikTokShowcaseUrl('https://shop.tiktok.com/view/product/123'))
  check('a short share link is accepted', isTikTokShowcaseUrl('https://vt.tiktok.com/ZSabc123/'))
  check('http is refused', !isTikTokShowcaseUrl('http://www.tiktok.com/@x/showcase'),
    'every click would be downgraded, and TikTok is https-only anyway')
  check('another site is refused', !isTikTokShowcaseUrl('https://example.com/shop'),
    'a mistyped link publishes to a real audience and every click for the life of the post goes nowhere')
  check('a lookalike domain is refused', !isTikTokShowcaseUrl('https://tiktok.com.evil.co/@x'),
    'suffix matching has to be anchored or any host can end in the right letters')
  check('empty is refused', !isTikTokShowcaseUrl(''))

  check('a pasted bare host gets a scheme', normalizeShowcaseUrl('www.tiktok.com/@x/showcase') === 'https://www.tiktok.com/@x/showcase',
    'copying from the TikTok app often drops it, and rejecting something obviously right is worse than fixing it')
  check('whitespace is trimmed', normalizeShowcaseUrl(`  ${SHOWCASE}  `) === SHOWCASE)
  check('junk normalizes to null', normalizeShowcaseUrl('not a url') === null)
}

// ── the toggle off changes nothing ──────────────────────────────────────────
{
  const d = resolvePostDestination({ ...base, useShowcase: false, showcaseUrl: SHOWCASE })
  check('off keeps Amazon', d.kind === 'amazon', d.kind)
  check('off keeps the tag', d.url === amazonDestination(ASIN, 'gomin-20'), d.url)
  check('off keeps the ASIN for geo-routing', d.asinForCloak === ASIN)
  check('off keeps the price claims', !d.suppressAmazonClaims)
  check('off says nothing', d.note === null)
  check('off allows every style', d.allowedStyles.length === 4)
}

// ── the toggle on, with a good link ─────────────────────────────────────────
{
  const d = resolvePostDestination({ ...base, useShowcase: true, showcaseUrl: SHOWCASE })
  check('on points at the showcase', d.kind === 'showcase' && d.url === SHOWCASE, d.url)
  check('THE ASIN IS DROPPED', d.asinForCloak === null,
    'Passport geo-routes an ASIN to the reader’s local Amazon, so passing it here sends every click to Amazon while the post reads as a showcase post')
  check('no Amazon tag survives', !d.url.includes('tag='), d.url)
  check('the price claims are suppressed', d.suppressAmazonClaims)
  check('GENIUSLINK IS EXCLUDED', !d.allowedStyles.includes('geniuslink'),
    'it exists to geo-route Amazon links and nothing else')
  check('Passport is still allowed', d.allowedStyles.includes('passport'),
    'it shortens any destination, so showcase clicks are still counted')
  check('nothing to report when it worked', d.note === null)
}

// ── the toggle on with nothing usable falls back, LOUDLY ────────────────────
//
// The whole failure class this repo keeps re-finding: a silent fallback is
// indistinguishable from never having asked.
{
  const none = resolvePostDestination({ ...base, useShowcase: true, showcaseUrl: '' })
  check('no link falls back to Amazon', none.kind === 'amazon', 'a post must still publish with a working link')
  check('and says so', !!none.note && none.fallback === 'no-url', String(none.note))
  check('the message says where to fix it', /Settings|paste/i.test(none.note ?? ''), String(none.note))

  const bad = resolvePostDestination({ ...base, useShowcase: true, showcaseUrl: 'https://example.com/shop' })
  check('a wrong link falls back to Amazon', bad.kind === 'amazon')
  check('and says so differently', bad.fallback === 'bad-url' && !!bad.note, String(bad.note))
  check('the message describes a real showcase link', /tiktok\.com/i.test(bad.note ?? ''), String(bad.note))
  check('a fallback keeps the Amazon claims', !bad.suppressAmazonClaims,
    'it IS an Amazon post now, so suppressing them would strip a correct post for no reason')
  check('and keeps the ASIN', bad.asinForCloak === ASIN)
}

// ── the link style is swapped, not silently kept ────────────────────────────
{
  const d = resolvePostDestination({ ...base, useShowcase: true, showcaseUrl: SHOWCASE })
  const g = styleForDestination(d, 'geniuslink', { passportAvailable: true })
  check('geniuslink becomes passport when available', g.style === 'passport' && g.changedFrom === 'geniuslink')
  check('and the swap is explained', !!styleSwapNote(g.changedFrom, g.style))
  check('the explanation says clicks are still counted', /counted/i.test(styleSwapNote(g.changedFrom, g.style) ?? ''))

  const g2 = styleForDestination(d, 'geniuslink', { passportAvailable: false })
  check('without passport it falls to direct', g2.style === 'direct' && g2.changedFrom === 'geniuslink')
  check('and says clicks are NOT counted', /not counted/i.test(styleSwapNote(g2.changedFrom, g2.style) ?? ''),
    'a creator losing their click stats has to be told, not left to notice')

  for (const keep of ['passport', 'bitly', 'direct'] as const) {
    const r = styleForDestination(d, keep, { passportAvailable: true })
    check(`${keep} is left alone`, r.style === keep && r.changedFrom === null)
    check(`and ${keep} says nothing`, styleSwapNote(r.changedFrom, r.style) === null,
      'crying wolf on a style that was never changed is its own bug')
  }

  const amazon = resolvePostDestination({ ...base, useShowcase: false, showcaseUrl: SHOWCASE })
  check('an Amazon post keeps geniuslink', styleForDestination(amazon, 'geniuslink').style === 'geniuslink',
    'turning the toggle OFF must not have taken their shortener away')
}

// ── the disclosure stops naming the wrong programme ─────────────────────────
{
  const AMZ = 'As an Amazon Associate I earn from qualifying purchases.'
  const s = disclaimerForDestination('showcase', null, AMZ)
  check('a showcase post does not claim Amazon Associates', !/amazon associate/i.test(s), s)
  check('but still discloses', /affiliate/i.test(s), s)
  check('the material connection is still stated', /commission/i.test(s), s)
  check('an Amazon post keeps the Associates line', disclaimerForDestination('amazon', null, AMZ) === AMZ)
  check('the creator’s own wording always wins', disclaimerForDestination('showcase', 'My own words', AMZ) === 'My own words',
    'a disclosure they wrote is a legal choice, not a default to override')
  check('the showcase default carries no dash', !/[—–]|\s-\s/.test(SHOWCASE_DISCLAIMER), SHOWCASE_DISCLAIMER)
}

// ── PINTEREST: the cloaked showcase link would be refused ───────────────────
//
// Pinterest rejects affiliate redirect and cloaking domains as a class, and
// mvpl.ink is on that list. A showcase pin therefore has to carry the RAW
// showcase URL, not the Passport-wrapped one it uses everywhere else.
{
  check('a tiktok link is fine for Pinterest', !isBlockedPinLink(SHOWCASE),
    'this is what makes a showcase pin able to point straight at the destination')
  check('but a Passport link is not', isBlockedPinLink('https://www.mvpl.ink/e6xfk55'),
    'so wrapping the showcase for a pin would fail the belt-and-braces check and the pin would not publish')

  const PIN = readFileSync('lib/amazon-pin-publish.ts', 'utf8')
  check('the pin path uses the raw showcase URL', /showcaseDest\?\.kind === 'showcase'/.test(PIN))
  check('and skips the Link-in-Bio detour', /resolvePinDestinationFor\(/.test(PIN) && /showcaseDest\?\.kind === 'showcase'[\s\S]{0,200}?:\s*await resolvePinDestinationFor/.test(PIN),
    'the detour exists because Pinterest blocks affiliate redirects; a showcase is the creator’s own shop and needs none')
}

// ── no caller re-introduces the ASIN or Geniuslink on a showcase post ───────
{
  const QP = readFileSync('lib/deal-quick-post.ts', 'utf8')
  check('quick post cloaks with the destination ASIN', /asin: cloakAsin/.test(QP),
    'passing the raw asin would geo-route every click back to Amazon')
  check('and with the destination-corrected style', /config: effectiveStyle/.test(QP))
  check('quick post drops the Amazon claims from the caption',
    /destination\.suppressAmazonClaims/.test(QP))
  check('and does not demand an Associates tag for a showcase post',
    /destination\.kind !== 'showcase'/.test(QP),
    'a creator who does not sell on Amazon at all would be blocked from posting')

  const PIN = readFileSync('lib/amazon-pin-publish.ts', 'utf8')
  // Compared by POSITION rather than by a bounded regex: the distance between
  // the two is incidental and a character budget would silently stop testing
  // the thing as soon as the branch grew.
  const showcaseAt = PIN.indexOf('if (opts.useShowcase)')
  const passportAt = PIN.indexOf('passportLinkForUserDetailed(createAdminClient()')
  check('the shared resolver has a showcase branch', showcaseAt > -1)
  check('and it comes BEFORE Passport-by-ASIN', showcaseAt > -1 && passportAt > -1 && showcaseAt < passportAt,
    `showcase at ${showcaseAt}, passport at ${passportAt} — passportLinkForUserDetailed geo-routes the ASIN to the reader's local Amazon, so reaching it first sends every click to Amazon on a post that reads as a showcase post`)
}

// ── the queue fires with the destination it was queued with ─────────────────
{
  for (const [f, field] of [
    ['app/api/cron/process-deal-schedules/route.ts', 'row.destination_kind'],
    ['app/api/cron/process-amazon-schedules/route.ts', 'row.destination_kind'],
  ] as const) {
    const SRC = readFileSync(f, 'utf8')
    check(`${f} reads the stored destination`, SRC.includes(field))
    check(`${f} does not re-resolve it`, !/resolvePostDestination/.test(SRC),
      'the composer told the creator where this post would go; changing their saved default must not redirect it')
  }
}

// ── the screen says where the clicks went ───────────────────────────────────
{
  const MODAL = readFileSync('components/deal/QuickPostModal.tsx', 'utf8')
  check('the quick-post modal blocks an unusable toggle', /showcaseMissing/.test(MODAL),
    'posting anyway publishes Amazon links under a switch that reads as on')
  const TOGGLE = readFileSync('components/product/ShowcaseToggle.tsx', 'utf8')
  check('the shared toggle exposes the same block', /blocked: on && !effective/.test(TOGGLE))
  check('and warns what else changes', /prices and discounts/i.test(TOGGLE),
    'a creator not told the price claims disappear will think the writer broke')

  const PAGE = readFileSync('app/(dashboard)/deals/page.tsx', 'utf8')
  check('the deals screen reports the destination', /function destinationNote/.test(PAGE))
  check('and will not publish a blocked blog post', /!socialsOnly && showcase\.blocked/.test(PAGE))

  const DEALS = readFileSync('app/api/deals/route.ts', 'utf8')
  check('the deal route suppresses the price block', /dealDestination\.suppressAmazonClaims \? '' : buildPriceSnapshotHtml/.test(DEALS),
    'the "lowest price we’ve tracked" verdict is an Amazon fact')
  check('and the price context fed to the writer', /dealDestination\.suppressAmazonClaims \? '' : buildPriceContext/.test(DEALS))
  check('and tells the writer not to name Amazon', /NEVER write the word Amazon/.test(DEALS))
  check('and reports which destination was used', /destinationKind: dealDestination\.kind/.test(DEALS))
}

// ── the integrations read cannot 400 on an un-migrated database ─────────────
{
  for (const f of ['app/api/amazon/fb/route.ts', 'app/api/amazon/ig/route.ts', 'app/api/amazon/pin/route.ts']) {
    const SRC = readFileSync(f, 'utf8')
    check(`${f} does not name tiktok_showcase_url in a select`,
      !/select\('[^']*tiktok_showcase_url/.test(SRC),
      'PostgREST rejects the WHOLE statement over one missing column, so naming it would break every post before migration 332 runs')
  }
  const SQL = readFileSync('supabase/migrations/332_tiktok_showcase_destination.sql', 'utf8')
  check('every column in 332 is guarded', !/add column(?! if not exists)/.test(SQL))
  check('332 is re-runnable', /if not exists/.test(SQL))
}

// ── THE ACCOUNT DEFAULT, so a TikTok seller sets it once ────────────────────
//
// The per-post toggle alone does not serve a creator who SELLS on TikTok: they
// would tick a box on every post on every surface forever, and the first one
// they forget silently publishes an Amazon link. The default lives on the
// account (migration 333) and every surface inherits it.
{
  const CLOAK = readFileSync('lib/link-cloak.ts', 'utf8')
  check('the shared config carries the account default', /destinationDefault: 'amazon' \| 'showcase'/.test(CLOAK))
  check('and the saved shop link', /showcaseUrl: string \| null/.test(CLOAK))
  check('getLinkStyle still reads select(*)', /\.select\('\*'\)/.test(CLOAK),
    'naming link_destination_default would make PostgREST reject the whole read and reset EVERY creator to direct links, which is exactly how this feature was dead in production once before')
  check('a showcase default with no link is not a showcase default',
    /=== 'showcase' && showcaseUrl \? 'showcase' : 'amazon'/.test(CLOAK),
    'otherwise every post on the account falls back and reports a fallback, which is noise rather than information')
  check('the resolver applies it', /const useShowcase = opts\.destinationOverride/.test(CLOAK))
  check('and drops the ASIN when it does', /dest = cfg\.showcaseUrl\s*\n\s*asin = ''/.test(CLOAK),
    'the single most important line: a surviving ASIN geo-routes every click back to Amazon')
  check('an explicit per-post choice overrides the account',
    /opts\.destinationOverride\s*\n?\s*\? opts\.destinationOverride === 'showcase'/.test(CLOAK),
    'a shop account still needs to be able to make one Amazon post')
}

// ── every hand-rolled link path inherits it ─────────────────────────────────
//
// Seven paths predate the shared resolver and build their own Passport /
// Bitly / Geniuslink chain. Each needs the account default applied explicitly,
// and a path that is missed is invisible: it just keeps publishing Amazon
// links inside an article whose every other link points at the shop.
{
  for (const f of [
    'app/api/blog/generate/route.ts',
    'app/api/blog/comparison/route.ts',
    'app/api/blog/from-link/route.ts',
    'app/api/campaigns/generate/route.ts',
    'lib/pin-product-link.ts',
    'lib/weekly-digest.ts',
  ]) {
    const SRC = readFileSync(f, 'utf8')
    check(`${f} honours the account default`,
      /resolveShowcaseLink\(|showcaseOverrideFor\(/.test(SRC),
      'this path hand-rolls its own link chain, so it does not inherit anything for free')
  }

  const CLOAK = readFileSync('lib/link-cloak.ts', 'utf8')
  check('the helper never passes an ASIN on', !/resolveShowcaseLink[\s\S]{0,1500}?passportLinkForUser\(/.test(CLOAK),
    'passportLinkForUser geo-routes an ASIN to the reader\u2019s local Amazon')
  check('and returns the shop link even when the mint fails',
    /code \? passportLinkUrl\(code\) : sc\.url/.test(CLOAK),
    'the destination the creator chose matters more than counting the click')
}

// ── the composers show the account's real state ─────────────────────────────
{
  const TOGGLE = readFileSync('components/product/ShowcaseToggle.tsx', 'utf8')
  check('the toggle starts ticked on a shop account',
    /linkDestination === 'showcase'[\s\S]{0,80}?setOn\(true\)/.test(TOGGLE),
    'a control that always started off would tell a TikTok-first creator something untrue on every post')
  check('and unticking it on a shop account reads as a choice',
    /This one post will link to Amazon instead/.test(TOGGLE),
    'otherwise it looks identical to a box that was simply never on')

  const MODAL = readFileSync('components/deal/QuickPostModal.tsx', 'utf8')
  check('the modal uses the shared control, not a copy',
    /<ShowcaseToggle/.test(MODAL) && !/Send clicks to my TikTok Shop showcase<\/span>/.test(MODAL),
    'two copies drift, and the one that drifts is the one nobody is looking at')

  const BRAND = readFileSync('app/(dashboard)/brand/page.tsx', 'utf8')
  check('settings has its own card for the destination', /Where your links send people/.test(BRAND))
  check('and warns when the default cannot take effect',
    /cannot take effect and every post will keep linking to Amazon/.test(BRAND),
    'a shop default with no shop link is the one state that fails on every post at once')
}

// ── an explicit toggle still beats the account default ──────────────────────
{
  for (const f of [
    'app/api/amazon/fb/route.ts', 'app/api/amazon/ig/route.ts', 'app/api/amazon/pin/route.ts',
    'app/api/deal-radar/social-post/route.ts', 'app/api/deals/route.ts',
  ]) {
    const SRC = readFileSync(f, 'utf8')
    check(`${f} treats an absent toggle as inherit`,
      /typeof body\.useShowcase === 'boolean'/.test(SRC),
      'reading it as `=== true` would make an unticked box indistinguishable from an absent one and strip a shop account back to Amazon')
    check(`${f} falls back to the account default`,
      /link_destination_default/.test(SRC))
  }
  const SQL = readFileSync('supabase/migrations/333_link_destination_default.sql', 'utf8')
  check('333 is re-runnable', /add column if not exists/.test(SQL))
}

if (failures.length) {
  console.error(`\n❌ showcase-destination: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ showcase-destination: the ASIN is dropped, Geniuslink is excluded, Amazon price claims and the Associates line come off, Pinterest gets the raw link, and a fallback is never silent')
