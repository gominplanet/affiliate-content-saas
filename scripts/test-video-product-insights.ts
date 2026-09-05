// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does the video-to-product join claim only what it can support?
//
// This is the join that finally connects the video library to the money, and it
// is the easiest place on the whole page to say something false. Earnings are
// recorded per PRODUCT and a product can appear in a dozen videos, so "this
// video earned $500" is a claim the data cannot carry. The one case where it
// can is a product featured in exactly one video, and telling those two apart is
// most of what this file checks.
import { analyseVideoProducts, type VideoLite, type VideoProduct, type ProductEarning, type ShelfRow } from '../lib/video-product-insights'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const v = (aci: string, views: number, read = true): VideoLite => ({
  aci, description: `video ${aci}`, views, hearts: 3,
  published_at: '2025-06-01T00:00:00Z',
  products_synced_at: read ? '2026-09-05T00:00:00Z' : null,
})

const videos: VideoLite[] = [v('a1', 1000), v('a2', 500), v('a3', 20), v('a4', 90, false)]
const links: VideoProduct[] = [
  // SOLE is in one video only, so its money has one place it can come from.
  { aci: 'a1', asin: 'BSOLE00001', title: 'Sole Product' },
  // SHARED is in three, so no single video can be credited with its earnings.
  { aci: 'a1', asin: 'BSHARED001', title: 'Shared Product' },
  { aci: 'a2', asin: 'BSHARED001', title: 'Shared Product' },
  { aci: 'a3', asin: 'BSHARED001', title: 'Shared Product' },
  // Filmed, and Amazon reported nothing for it.
  { aci: 'a2', asin: 'BQUIET0001', title: 'Quiet Product' },
]
const earnings: ProductEarning[] = [
  { asin: 'BSOLE00001', product_title: 'Sole Product', earnings_cents: 50000 },
  { asin: 'BSHARED001', product_title: 'Shared Product', earnings_cents: 90000 },
  // Earning well, and nothing has ever been filmed for it.
  { asin: 'BNOVIDEO01', product_title: 'Unfilmed Earner', earnings_cents: 120000 },
  // Reported, but at nothing. A real zero, not an absence.
  { asin: 'BZERO00001', product_title: 'Zero Earner', earnings_cents: 0 },
]
const shelf: ShelfRow[] = [
  { asin: 'BSOLE00001', title: 'Sole Product' },
  { asin: 'BSHELF0001', title: 'On The Shelf, Never Filmed' },
]

const r = analyseVideoProducts(videos, links, earnings, shelf, true)

// ── the claim that must never be made ───────────────────────────────────────
check('a product in several videos is never credited to one of them',
  !r.soleVideo.some(s => s.asin === 'BSHARED001'),
  r.soleVideo.map(s => s.asin).join(', '))
check('a product in exactly one video is credited to it',
  r.soleVideo.length === 1 && r.soleVideo[0].asin === 'BSOLE00001' && r.soleVideo[0].aci === 'a1',
  JSON.stringify(r.soleVideo))
check('the sole-video figure is the real one', r.soleVideo[0]?.earningsCents === 50000)

// A video containing a shared product must not be flagged as sole, even though
// it also contains a product that is.
const a1 = r.topVideosByProductEarnings.find(x => x.aci === 'a1')
check('a video is only sole when every product in it is', a1 && a1.sole === false,
  `a1.sole=${a1?.sole}`)
check('a video is ranked by what its products earned, both of them',
  a1?.productEarningsCents === 140000, `got ${a1?.productEarningsCents}`)

// ── the actionable gap ──────────────────────────────────────────────────────
check('a product earning with nothing filmed for it is surfaced',
  r.earningNoVideo.some(p => p.asin === 'BNOVIDEO01'),
  r.earningNoVideo.map(p => p.asin).join(', '))
check('a product that earned nothing is not called an opportunity',
  !r.earningNoVideo.some(p => p.asin === 'BZERO00001'))
check('a product that already has a video is not called unfilmed',
  !r.earningNoVideo.some(p => p.asin === 'BSOLE00001' || p.asin === 'BSHARED001'))

// ── effort against return ───────────────────────────────────────────────────
const filmed = r.mostFilmed.find(p => p.asin === 'BSHARED001')
check('a product filmed repeatedly is surfaced with its earnings',
  filmed?.videos === 3 && filmed?.earningsCents === 90000, JSON.stringify(filmed))
check('a product filmed once is not in the repeat list',
  !r.mostFilmed.some(p => p.asin === 'BSOLE00001'))
check('a filmed product Amazon never reported on stays null, not zero',
  r.mostFilmed.every(p => p.asin !== 'BQUIET0001') , 'filmed once, so out of this list anyway')

// ── coverage, so nothing reads as a statement about the whole library ───────
check('coverage counts only the videos actually read',
  r.coverage.videosRead === 3, `videosRead=${r.coverage.videosRead}`)
check('coverage counts videos that have a product',
  r.coverage.videosWithProduct === 3, `${r.coverage.videosWithProduct}`)
check('coverage counts earning products and how many are filmed',
  r.coverage.earningProducts === 3 && r.coverage.earningProductsWithVideo === 2,
  `${r.coverage.earningProductsWithVideo} of ${r.coverage.earningProducts}`)

// ── the shelf ───────────────────────────────────────────────────────────────
check('a shelf product with no video is surfaced',
  r.shelfNoVideo.some(p => p.asin === 'BSHELF0001'))
check('a shelf product that has a video is not', !r.shelfNoVideo.some(p => p.asin === 'BSOLE00001'))

// ── nothing read yet ────────────────────────────────────────────────────────
// Before the product crawl runs there are no links at all, and every one of
// these lists has to come back empty rather than confidently wrong.
// Genuinely unread: products_synced_at null on every video, which is the state
// before the product crawl has ever run. Marking them read with no links found
// would be a different and legitimate finding, so the distinction matters.
const nothing = analyseVideoProducts(
  videos.map(x => ({ ...x, products_synced_at: null })), [], earnings, shelf, false,
)
check('with no products read, no video is credited with money', nothing.soleVideo.length === 0)
check('with no products read, no video is ranked', nothing.topVideosByProductEarnings.length === 0)
check('with no products read, the shelf makes no claim', nothing.shelfNoVideo.length === 0)
check('with no products read, coverage says so',
  nothing.coverage.videosWithProduct === 0 && nothing.coverage.earningProductsWithVideo === 0)
// This is the trap the whole file exists to avoid: with no links read, EVERY
// earning product looks unfilmed. That is true of the data and false about the
// creator, and acting on it means shooting a video that already exists. The list
// is refused until enough of the library has been read to mean anything.
check('with no products read, nothing is called unfilmed',
  nothing.earningNoVideo.length === 0, `${nothing.earningNoVideo.length} products wrongly called unfilmed`)
check('with no products read, the coverage flag says why', nothing.coverage.readEnough === false)

// And once the library HAS been read, the same list appears.
const readAll = analyseVideoProducts(
  videos.map(x => ({ ...x, products_synced_at: '2026-09-05T00:00:00Z' })),
  links, earnings, shelf, true,
)
check('once the library is read, the unfilmed earner appears',
  readAll.coverage.readEnough === true && readAll.earningNoVideo.some(p => p.asin === 'BNOVIDEO01'),
  `readEnough=${readAll.coverage.readEnough}, ${readAll.earningNoVideo.length} listed`)

console.log(failures.length ? 'FAIL' : 'ALL PASS')
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
