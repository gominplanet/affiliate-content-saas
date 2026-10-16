// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FIND BRANDS, THE CREATOR'S WAY (Seb, 2026-10-14, after Rob's Oink Blue
// video: "build all 4"): the brand on Amazon, your priorities, more filters,
// and your stage (volume first, then double down on winners).

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readDirStats, rawKeys, amazonOf, titleIsBrand, nameVariants, readFilters, filterCheck, stageOf, onAmazon } from '../lib/trybe-finder'
import { pickScore, weighScore, readPriorities, DEFAULT_PRIORITIES, FACTORS } from '../lib/trybe-pick'
import { payPasses, readPay } from '../lib/trybe-outreach'
import type { Judged, MyBrand } from '../lib/trybe-mybrands'
import { trybeAccess, TRYBE_PREVIEW_ACTIONS } from '../lib/labs-preview'
import { productOnAmazon, productWords, filmedProducts } from '../lib/trybe-finder'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// ── TRYBE's own numbers, found by name, never made up ──
const st = readDirStats({ brandId: 'b-123456', brand: { approvedVideos: 42, anySampleRequestsEnabled: true, createdAt: '2026-09-30T00:00:00Z' }, stats: { totalPaid: '1,250' } })
check('videos approved, paid out, samples and join date are read from the entry or one level down', st.videosApproved === 42 && st.paidOut === 1250 && st.samples === true && st.joinedAt === '2026-09-30T00:00:00.000Z', JSON.stringify(st))
const none = readDirStats({ brandId: 'b-123456', name: 'X' })
check('a number TRYBE did not send is not known, never zero', none.videosApproved === null && none.paidOut === null && none.samples === null && none.joinedAt === null)
check('the admin sees which keys TRYBE sends', rawKeys([{ a: 1, brand: { b: 2 } }]).join() === 'a,brand,brand.b')

// ── 1. The brand on Amazon ──
check('a product title starting with the brand is the brand', titleIsBrand('Audien Atom ONE Hearing Aid', 'Audien') && titleIsBrand('Jive Nutrition Protein Powder', 'Jive Nutrition'))
check('a brand name inside another word, or a 2 letter name, never matches', !titleIsBrand('Audienne Speakers', 'Audien') && !titleIsBrand('Go Pro Mount', 'Go'))
check('Amazon writes names in several cases: all are looked up', nameVariants('Kings Loot').includes('KINGS LOOT') && nameVariants('Kings Loot').includes('kings loot'))
const amz = amazonOf('Audien', {
  videos: [{ aci: 'v1', asin: 'B0AAA11111', title: 'Some hearing aid' }, { aci: 'v2', asin: 'B0ZZZ99999', title: 'Audien Atom Pro 2' }, { aci: 'v3', asin: 'B0QQQ00000', title: 'Other brand thing' }],
  storefront: new Map([['audien', 4]]),
  campaigns: [
    { brand_name: 'AUDIEN', asins: ['B0AAA11111'], commission_pct: 15, ends_at: '2026-12-31' },
    { brand_name: 'Audien', asins: ['B0OLD00000'], commission_pct: 30, ends_at: '2026-01-01' },
    { brand_name: 'Other', asins: ['B0QQQ00000'], commission_pct: 50, ends_at: '2026-12-31' },
  ],
  today: '2026-10-14',
})
check('your Amazon videos of its products count, by campaign ASIN or by title', amz.yourVideos === 2 && amz.videoAcis.includes('v1') && amz.videoAcis.includes('v2'), JSON.stringify(amz))
check('another brand\'s campaign never counts', !amz.videoAcis.includes('v3'))
check('only campaigns still running count, with the best live commission', amz.ccCampaigns === 1 && amz.ccBestPct === 15)
check('storefront products are counted, and an Amazon product is linked', amz.storefront === 4 && !!amz.asin && onAmazon(amz))
check('a brand MVP found nothing for is not on Amazon', !onAmazon(amazonOf('Nobody', { videos: [], storefront: new Map(), campaigns: [], today: '2026-10-14' })))

// ── 2. Your priorities ──
const p = pickScore({ totalCreators: 3, metaAds: 120, top100Hits: null, tiktokShop: null, perVideo: 60, samples: true, amazon: { yourVideos: 2, storefront: 0, ccCampaigns: 1, ccBestPct: 15 } })
check('every point is booked to a factor, and all normal is the plain score', weighScore(p, DEFAULT_PRIORITIES) === p.score && Object.keys(p.parts).length >= 5)
check('"A lot" counts a factor twice, "Skip" leaves it out', weighScore(p, { ...DEFAULT_PRIORITIES, amazon: 2 }) === p.score + (p.parts.amazon ?? 0) && weighScore(p, { ...DEFAULT_PRIORITIES, perVideo: 0 }) === p.score - (p.parts.perVideo ?? 0))
check('Amazon videos you already made are a reason, said in words', p.reasons.some(r => /You already have 2 Amazon videos/.test(r.text)) && p.reasons.some(r => /Creator Connections, up to 15%/.test(r.text)))
check('saved priorities are read safely: odd values are normal', JSON.stringify(readPriorities({ amazon: 2, perVideo: 7, junk: 1 })) === JSON.stringify({ ...DEFAULT_PRIORITIES, amazon: 2 }))
check('every factor has words for the creator', FACTORS.length === 10 && FACTORS.every(f => f.label && f.says && !/[–—]/.test(f.says)))
const plain = pickScore({ totalCreators: 3, metaAds: null, top100Hits: null, tiktokShop: null })
check('an older brand with no new numbers scores as before', plain.score === 35 && plain.read === 1)

// ── 3. Filters ──
const f = readFilters({ minPerVideo: '50', maxCreators: 20, samples: true, onAmazon: true, starred: 'yes' })
check('filters are read safely', f.minPerVideo === 50 && f.maxCreators === 20 && f.samples === true && f.onAmazon === true && f.starred === false)
const row = { perVideo: 75, creators: 10, stats: { videosApproved: null, paidOut: null, samples: null, joinedAt: null }, earningsBucket: null, amazon: amz, starred: false }
const c1 = filterCheck(row, f)
check('a brand passing what is known passes, and samples TRYBE did not give is not known', c1.pass && c1.unknown.join() === 'samples' && !c1.failed.length, JSON.stringify(c1))
const c2 = filterCheck({ ...row, perVideo: 20, creators: 400 }, f)
check('a brand that fails a filter is hidden, with each reason', !c2.pass && c2.failed.includes('minPerVideo') && c2.failed.includes('maxCreators'))
const c3 = filterCheck({ ...row, perVideo: null }, { minPerVideo: 25 })
check('At least $X a video hides a brand with no pay figure, counted as blank, never listed after', !c3.pass && c3.failed.join() === 'minPerVideo' && c3.blank.join() === 'minPerVideo' && !c3.unknown.length, JSON.stringify(c3))
check('a brand paying less is hidden but not blank', filterCheck({ ...row, perVideo: 20 }, { minPerVideo: 25 }).blank.length === 0)
check('the page says how many had no pay figure', /with no pay figure/.test(read('components/labs/TrybeFinderControls.tsx')) && /blankBy/.test(read('app/api/labs/trybe/route.ts')))
{
  const peek = read('components/labs/TrybeBrandPeek.tsx'), ch = read('components/labs/TrybeChanges.tsx'), bn = read('components/labs/TrybeBestNew.tsx'), out = read('components/labs/TrybeOutreach.tsx'), rt = read('app/api/labs/trybe/route.ts')
  check('What changed opens a brand with the Find brands details, read by id', /ids: \[id\]/.test(peek) && /idsQ\.length\) q = q\.in\('brand_id', idsQ\)/.test(rt) && /<BrandExtras /.test(peek) && /<PayChip /.test(peek))
  check('What changed and Best new brands both open the details', /<TrybeBrandPeek /.test(ch) && /<TrybeBrandPeek /.test(bn) && /actions=\{actions\}/.test(ch))
  check('the details write and send with the same steps as Find brands and Ready to send', /message: \(id\) => draftPicked\(\[id\]\)/.test(out) && /await sendOne\(b\)/.test(out) && (out.match(/actions=\{peekActions\}/g) || []).length === 2)
  check('the Amazon preview shows details only, never a send', /const peekActions: PeekActions \| undefined = preview \? undefined/.test(out))
  check('a brand TRYBE no longer lists says so instead of a blank panel', /TRYBE no longer lists/.test(peek))
}
check('On Amazon is a no when MVP found nothing, never unknown', filterCheck({ ...row, amazon: null }, { onAmazon: true }).failed.join() === 'onAmazon')
check('"% plus a fee" passes only brands that pay both', payPasses(readPay('$50 per video + 10% of sales'), 'both') && !payPasses(readPay('$50 per video'), 'both'))

// ── 4. Your stage ──
const mk = (name: string, earnings: number | null, approved: number | null): MyBrand => ({ id: name, name, logo: null, earnings, submitted: approved, approved, pending: null, rejected: null, enrolledAt: null, programs: [] })
const j = (b: MyBrand, verdict: Judged['verdict']): Judged => ({ brand: b, verdict, why: '', rate: null, exactRate: false, perVideo: null })
check('no brands yet: start with volume', stageOf([]).stage === 'start')
const vol = stageOf([j(mk('A', 0, 1), 'early'), j(mk('B', null, 0), 'early')])
check('brands but no winner yet: volume, learn what pays', vol.stage === 'volume' && vol.joined === 2 && /winner/.test(vol.says))
const dbl = stageOf([j(mk('Audien', 900, 20), 'focus'), j(mk('B', 0, 1), 'early')])
check('a winner found: double down and keep testing, naming it', dbl.stage === 'double' && dbl.winners.join() === 'Audien' && /keep asking new brands/.test(dbl.says))
const many = stageOf(['A', 'B', 'C'].map(n => j(mk(n, 500, 10), 'focus')))
check('three winners: most videos into them, new brands at a slower pace', many.stage === 'double' && /slower pace/.test(many.says))
check('stage words have no dashes and no year', [vol, dbl, many, stageOf([])].every(s => !/[–—]| - |20\d\d/.test(`${s.title} ${s.says}`)))

// ── Wired in ──
const api = read('app/api/labs/trybe/route.ts')
const browse = api.slice(api.indexOf("action === 'browse'"), api.indexOf("action === 'adopt'"))
check('the brand search reads Amazon, TRYBE\'s numbers, the filters and the priorities', /amazonOf\(/.test(browse) && /readDirStats\(/.test(browse) && /filterCheck\(/.test(browse) && /weighScore\(/.test(browse) && /amazonContext\(admin, ownerId/.test(browse) && /cc_campaign_catalog/.test(api.slice(api.indexOf('async function amazonContext('))) && /amazon_video_products/.test(api.slice(api.indexOf('async function amazonContext('))))
check('a read of Amazon that failed is said, not taken as "not on Amazon"', /notes\.push\('Your Amazon videos could not be read/.test(api) && /notes: amazonNotes/.test(browse) && /amazonNotes/.test(read('components/labs/TrybeOutreach.tsx')))
check('filters count what they hid and what they could not check', /hiddenBy\[f\]/.test(browse) && /unknownBy\[f\]/.test(browse) && /knownFirst\(a, b\)/.test(browse))
check('a passed brand leaves the list until undone', /'removed', 'skipped'\]/.test(browse))
check('star, priorities and pass are saved on the server', /action === 'star'/.test(api) && /action === 'priorities'/.test(api) && /action === 'pass'/.test(api))
check('pass never touches a brand already written or sent', /\.in\('status', \['new', 'not_fit'\]\)/.test(api.slice(api.indexOf("action === 'pass'"))))
check('only an admin sees what TRYBE\'s list sends', /tier === 'admin' \? \{ rawKeys/.test(browse))
const mig = 'supabase/migrations/430_trybe_priorities_and_stars.sql'
check('migration 430 adds the two columns and is safe to run twice', existsSync(join(process.cwd(), mig)) && (read(mig).match(/add column if not exists/g) || []).length === 2)
const ui = read('components/labs/TrybeOutreach.tsx')
check('Find brands shows the stage, filters, priorities, Amazon and star and pass', /<TrybeStage canRead=\{canMyBrands\}/.test(ui) && /<FinderFilterBar/.test(ui) && /<FinderPriorities/.test(ui) && /<BrandExtras amazon=\{b\.amazon\}/.test(ui) && /<StarButton/.test(ui) && /<PassButton/.test(ui) && /<FinderFilterNote/.test(ui))
check('no Amazon videos synced is said, with where to sync them', /MVP has none of your Amazon videos yet/.test(ui) && /href="\/earnings"/.test(ui))
const stage = read('components/labs/TrybeStage.tsx')
check('a failed read of your numbers says the stage is not known', /your stage is not known/.test(stage))

// ── The Amazon plan's preview (Seb, 2026-10-14: "build the amazon plan preview") ──
check('Pro and admin get all of TRYBE, the Amazon plan the preview, a trial none', trybeAccess('pro') === 'full' && trybeAccess('admin') === 'full' && trybeAccess('amazon') === 'preview' && trybeAccess('trial') === 'none' && trybeAccess(null) === 'none')
const AI_OR_SEND = ['draft', 'video_plan', 'kickoff', 'followup', 'hook_fix', 'suggest_reply', 'brief_read', 'match', 'claim', 'result', 'directory', 'meta_ads', 'top100', 'adopt', 'settings', 'ideas', 'brand_products', 'import', 'shortlist']
check('the preview may browse, star, pass and rank, and nothing that calls AI, sends or writes the shared copy', ['browse', 'star', 'pass', 'unskip', 'priorities'].every(a => TRYBE_PREVIEW_ACTIONS.has(a)) && AI_OR_SEND.every(a => !TRYBE_PREVIEW_ACTIONS.has(a)))
check('the server refuses every other action on the preview, before any work', /if \(g\.access === 'preview' && !TRYBE_PREVIEW_ACTIONS\.has\(action\)\)/.test(api) && api.indexOf("g.access === 'preview'") < api.indexOf("action === 'settings'"))
const page = read('app/(dashboard)/trybe/page.tsx')
check('the Amazon plan opens the page as a preview, and the menu shows it to them', /access === 'preview'\) return <TrybeOutreach preview \/>/.test(page) && /trybeAccess\(effectiveTier\) !== 'none'/.test(read('components/layout/DashboardShellV2.tsx')))
check('the preview never runs the daily find, reads the inbox or checks Meta ads', /if \(preview \|\| loading \|\| autoRan\.current/.test(ui) && /const canInbox = !preview &&/.test(ui) && /const canPlaybook = !preview &&/.test(ui))
check('a Pro tab opened on the preview says it is Pro, with the way there', /is on the Pro plan<\/p>/.test(ui) && /if \(preview && t !== 'find'\) \{ setLockedTab\(t\); return \}/.test(ui) && /Message brands on Pro/.test(ui))

check('the Setup check has no niche step: the search changes with every search', !/title: 'Your niche'/.test(ui) && !/Pick my niche/.test(ui))

// ── The Amazon match wherever a TRYBE brand or product shows (Seb, 2026-10-14) ──
check('a product\'s own words leave out the brand and common words', productWords('Kings Loot Passport Wallet', 'Kings Loot').join() === 'passport,wallet' && productWords('Kings Loot', 'Kings Loot').length === 0)
const kl = [{ aci: 'a1', asin: 'B01', title: 'Kings Loot Passport Wallet RFID Travel' }, { aci: 'a2', asin: 'B02', title: 'Kings Loot Minimalist Wallet for Men' }, { aci: 'a3', asin: 'B03', title: 'Other Brand Passport Wallet' }]
check('a product you filmed on Amazon is found by its own words, same brand only', productOnAmazon('Passport Wallet', 'Kings Loot', kl, new Set()).join() === 'a1' && productOnAmazon('Kings Loot Wallet', 'Kings Loot', kl, new Set()).sort().join() === 'a1,a2')
check('a product named only by its brand is never matched as a product', productOnAmazon('Kings Loot', 'Kings Loot', kl, new Set()).length === 0)
check('the server answers the Amazon match for any brands and products, read only', /action === 'amazon_match'/.test(api) && /productOnAmazon\(/.test(api) && /async function amazonContext\(/.test(api))
const placed: Array<[string, RegExp]> = [
  ['Ready to send', /<AmazonLine amazon=\{amazon\} className="mt-1" \/>/],
  ['Sent', /<AmazonLine amazon=\{amz\.brand\(b\.brand_id\)\} className="mt-1" \/>/],
]
for (const [where, re] of placed) check(`${where} shows the Amazon match`, re.test(ui))
check('Make videos shows it on each brand and each product (no link inside a button)', /<AmazonLine amazon=\{amz\.brand\(b\.id\)\} links=\{false\}/.test(read('components/labs/TrybeCreate.tsx')) && /<ProductAmazon match=\{amz\.product\(brand\.name, p\.name\)\} links=\{false\} \/>/.test(read('components/labs/TrybeCreate.tsx')))
check('My brands, This week, the Inbox brand card and the planner PDF show it', /<AmazonLine amazon=\{amz\.brand\(b\.id\)\}/.test(read('components/labs/TrybeMyBrands.tsx')) && /<ProductAmazon match=\{amz\.product\(r\.brand_name, r\.product\)\}/.test(read('components/labs/TrybeWeek.tsx')) && /<AmazonLine amazon=\{amz\.brand\(brand\.id\)\}/.test(read('components/labs/TrybeBrandCard.tsx')) && /Your Amazon video/.test(read('lib/trybe-planner-pdf.ts')))
check('a failed Amazon read is kept as an error, never as "not on Amazon"', /setError\(`The Amazon match could not be read/.test(read('components/labs/useTrybeAmazon.ts')))

// ── The address is /trybe (Seb, 2026-10-14: "not have the link say trybe outreach") ──
const moved = read('app/(dashboard)/trybe-outreach/page.tsx')
check('the old address sends you to /trybe on the same tab', /redirect\(`\/trybe\$\{qs \? `\?\$\{qs\}` : ''\}`\)/.test(moved) && !/TrybeOutreach \/>/.test(moved))
check('no link in MVP points at the old address', ['components/layout/DashboardShellV2.tsx', 'components/dashboard/WhatsNewCard.tsx', 'lib/today-list.ts', 'components/layout/useTrybeAlerts.ts'].every(f => !/\/trybe-outreach/.test(read(f))))

check('after a yes, the Amazon videos you already have are offered to submit first', /Submit \{onAmz\.yourVideos === 1 \? 'it' : 'them'\} on TRYBE first/.test(read('components/labs/TrybeAfterAccept.tsx')))

check('Make videos step 3 says when you already filmed the product on Amazon', /amz\.product\(brand\.name, product\)/.test(read('components/labs/TrybeCreate.tsx')) && /The scripts below are for new videos/.test(read('components/labs/TrybeCreate.tsx')))

// THE PRODUCTS YOU FILMED (Seb, 2026-10-15: show the ASIN, the product page
// and the videos, not a count).
{
  const vids = [
    { aci: 'a1', asin: 'B0AAA', title: 'NutraHarmony Magnesium Glycinate 120 Capsules' },
    { aci: 'a2', asin: 'B0AAA', title: 'NutraHarmony Magnesium Glycinate 120 Capsules' },
    { aci: 'a3', asin: 'B0BBB', title: 'NutraHarmony Ashwagandha Gummies' },
    { aci: 'a4', asin: 'B0AAA', title: null },
    { aci: 'a5', asin: 'B0CCC', title: 'Other Brand Fish Oil' },
  ]
  const fp = filmedProducts(vids.slice(0, 4))
  check('filmed products: one row per ASIN, most videos first', fp.length === 2 && fp[0].asin === 'B0AAA' && fp[0].acis.length === 3 && fp[1].asin === 'B0BBB')
  check('filmed products: a row keeps the product name when one video has none', fp[0].title === 'NutraHarmony Magnesium Glycinate 120 Capsules')
  check('filmed products: at most 3 videos a product', filmedProducts(Array.from({ length: 9 }, (_, i) => ({ aci: `x${i}`, asin: 'B0X', title: 't' })))[0].acis.length === 3)
  const a = amazonOf('NutraHarmony', { videos: vids, storefront: new Map(), campaigns: [], today: '2026-10-15' })
  check('the brand match lists the products filmed, never another brand', a.products.length === 2 && !a.products.some((p) => p.asin === 'B0CCC') && a.yourVideos === 3)
  const R = read('app/api/labs/trybe/route.ts')
  check('each filmed product goes out with its Amazon page and video links', /url: `https:\/\/www\.amazon\.com\/dp\/\$\{p\.asin\}`/.test(R) && /products: filmedLive\(a\.products\)/.test(R) && /products: filmedLive\(filmedProducts\(/.test(R))
  const C = read('components/labs/TrybeFinderControls.tsx')
  check('the list shows the ASIN to copy, the Amazon page and your videos', /ASIN \{asin\}/.test(C) && /Amazon page/.test(C) && /Your video/.test(C))
  for (const f of ['components/labs/TrybeCreate.tsx', 'components/labs/TrybeBrandCard.tsx', 'components/labs/TrybeAfterAccept.tsx']) check(`${f} shows the products you filmed`, /<AmazonFilmedList /.test(read(f)))
}

if (failed) { console.error(`\n${failed} TRYBE finder check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
