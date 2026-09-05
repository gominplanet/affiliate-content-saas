// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Where the video library meets the money.
//
// Until a video carries an ASIN it is an island: it can say how many people
// watched, and nothing about what that was worth. Once the per-video product
// read has run, the library joins to earnings, to the storefront and to what has
// been published off Amazon, and these are the questions that opens up.
//
// One rule shapes all of it. Earnings are recorded per PRODUCT, never per video,
// and a product can be featured in a dozen videos. So this file never claims a
// video earned anything. It says what the products in a video earned, which is a
// different and weaker statement, and it separates out the one case where the
// stronger statement is defensible: a product featured in exactly one video,
// where the onsite money has only one place it can have come from.
//
// Pure functions over rows, so scripts/test-video-product-insights.ts can run
// them without a browser, an extension or a live Amazon session.

export interface VideoLite {
  aci: string
  description: string | null
  views: number | null
  hearts: number | null
  published_at: string | null
  products_synced_at: string | null
}
export interface VideoProduct { aci: string; asin: string; title: string | null }
export interface ProductEarning { asin: string; product_title: string | null; earnings_cents: number | null }
/** A product on the creator's public storefront, and whether MVP has published a
 *  video for it anywhere off Amazon. */
export interface ShelfRow { asin: string; title: string | null }

export interface VideoProductInsights {
  ok: true
  /** How much of the library has been read for products, so nothing below can be
   *  mistaken for a statement about the whole library. */
  coverage: {
    videos: number
    videosRead: number
    videosWithProduct: number
    distinctProducts: number
    /** Products that earned, and how many of them a video covers. */
    earningProducts: number
    earningProductsWithVideo: number
    readEnough: boolean
  }
  /** Products featured in exactly one video. The only place a video can honestly
   *  be credited with the money, because there is nowhere else it came from. */
  soleVideo: {
    aci: string
    description: string | null
    asin: string
    title: string | null
    earningsCents: number
    views: number | null
  }[]
  /** Products earning without any video of the creator's on them. */
  earningNoVideo: { asin: string; title: string | null; earningsCents: number }[]
  /** Products filmed repeatedly, set against what they earned. Effort that did
   *  or did not pay, which is invisible from either table on its own. */
  mostFilmed: { asin: string; title: string | null; videos: number; earningsCents: number | null }[]
  /** Videos ranked by what the products in them earned. Never "what this video
   *  earned", which the data cannot support. */
  topVideosByProductEarnings: {
    aci: string
    description: string | null
    views: number | null
    products: number
    productEarningsCents: number
    sole: boolean
  }[]
  /** On the shelf, no video anywhere. */
  shelfNoVideo: { asin: string; title: string | null }[]
  shelfKnown: boolean
}

export function analyseVideoProducts(
  videos: VideoLite[],
  links: VideoProduct[],
  earnings: ProductEarning[],
  shelf: ShelfRow[],
  shelfKnown: boolean,
): VideoProductInsights {
  const byAci = new Map<string, VideoLite>()
  for (const v of videos) byAci.set(v.aci, v)

  // ASIN to the videos featuring it, and video to its ASINs.
  const videosForAsin = new Map<string, string[]>()
  const asinsForVideo = new Map<string, string[]>()
  const titleForAsin = new Map<string, string>()
  for (const l of links) {
    if (!l.aci || !l.asin) continue
    const va = videosForAsin.get(l.asin)
    if (va) { if (!va.includes(l.aci)) va.push(l.aci) } else videosForAsin.set(l.asin, [l.aci])
    const av = asinsForVideo.get(l.aci)
    if (av) { if (!av.includes(l.asin)) av.push(l.asin) } else asinsForVideo.set(l.aci, [l.asin])
    if (l.title && !titleForAsin.has(l.asin)) titleForAsin.set(l.asin, l.title)
  }

  // Earnings folded to one figure per product. A null stays out of the sum
  // rather than counting as zero, so a product Amazon reported nothing for is
  // absent rather than bottom of the ranking.
  const earnedByAsin = new Map<string, number>()
  for (const e of earnings) {
    if (!e.asin || e.earnings_cents == null) continue
    earnedByAsin.set(e.asin, (earnedByAsin.get(e.asin) ?? 0) + e.earnings_cents)
    if (e.product_title && !titleForAsin.has(e.asin)) titleForAsin.set(e.asin, e.product_title)
  }
  for (const s of shelf) { if (s.title && !titleForAsin.has(s.asin)) titleForAsin.set(s.asin, s.title) }

  const videosRead = videos.filter(v => v.products_synced_at != null).length
  const earningAsins = [...earnedByAsin.keys()].filter(a => (earnedByAsin.get(a) ?? 0) > 0)

  // ── the one honest attribution ──────────────────────────────────────────
  const soleVideo: VideoProductInsights['soleVideo'] = []
  for (const [asin, acis] of videosForAsin) {
    if (acis.length !== 1) continue
    const cents = earnedByAsin.get(asin)
    if (cents == null || cents <= 0) continue
    const v = byAci.get(acis[0])
    soleVideo.push({
      aci: acis[0],
      description: v?.description ?? null,
      asin,
      title: titleForAsin.get(asin) ?? null,
      earningsCents: cents,
      views: v?.views ?? null,
    })
  }
  soleVideo.sort((a, b) => b.earningsCents - a.earningsCents)

  // ── earning, with nothing filmed for it ─────────────────────────────────
  // Absence of a link is only evidence of absence of a video once most of the
  // library has actually been read. Before that every earning product looks
  // unfilmed, which is true of the data and false about the creator, and it
  // would send someone off to shoot a video they have already made. So the list
  // is not produced at all until the read has covered enough to mean something.
  const readEnough = videos.length > 0 && videosRead >= Math.max(1, videos.length * 0.5)
  const earningNoVideo = !readEnough ? [] : earningAsins
    .filter(a => !videosForAsin.has(a))
    .map(a => ({ asin: a, title: titleForAsin.get(a) ?? null, earningsCents: earnedByAsin.get(a) as number }))
    .sort((a, b) => b.earningsCents - a.earningsCents)
    .slice(0, 15)

  // ── filmed repeatedly, and whether it paid ──────────────────────────────
  const mostFilmed = [...videosForAsin.entries()]
    .map(([asin, acis]) => ({
      asin,
      title: titleForAsin.get(asin) ?? null,
      videos: acis.length,
      // Null, not zero: a product absent from the earnings report has not been
      // shown to earn nothing, it simply was not reported on.
      earningsCents: earnedByAsin.has(asin) ? (earnedByAsin.get(asin) as number) : null,
    }))
    .filter(p => p.videos > 1)
    .sort((a, b) => b.videos - a.videos)
    .slice(0, 15)

  // ── videos, by what their products earned ───────────────────────────────
  const topVideosByProductEarnings = [...asinsForVideo.entries()]
    .map(([aci, asins]) => {
      let cents = 0
      let any = false
      for (const a of asins) {
        const c = earnedByAsin.get(a)
        if (c != null) { cents += c; any = true }
      }
      const v = byAci.get(aci)
      return {
        aci,
        description: v?.description ?? null,
        views: v?.views ?? null,
        products: asins.length,
        productEarningsCents: any ? cents : 0,
        // True only when every product in the video is featured nowhere else,
        // which is when the money has one place it can have come from.
        sole: asins.length > 0 && asins.every(a => (videosForAsin.get(a) ?? []).length === 1),
        any,
      }
    })
    .filter(v => v.any)
    .sort((a, b) => b.productEarningsCents - a.productEarningsCents)
    .slice(0, 12)
    .map(({ any, ...rest }) => rest)

  // ── on the shelf, filmed nowhere ────────────────────────────────────────
  const shelfNoVideo = shelfKnown && readEnough
    ? shelf
      .filter(s => !videosForAsin.has(s.asin))
      .map(s => ({ asin: s.asin, title: titleForAsin.get(s.asin) ?? s.title ?? null }))
      .slice(0, 15)
    : []

  return {
    ok: true,
    coverage: {
      videos: videos.length,
      videosRead,
      videosWithProduct: asinsForVideo.size,
      distinctProducts: videosForAsin.size,
      earningProducts: earningAsins.length,
      earningProductsWithVideo: earningAsins.filter(a => videosForAsin.has(a)).length,
      /** Whether enough of the library has been read for "no video for this"
       *  to mean anything. False until it does, and the lists that depend on it
       *  come back empty rather than wrong. */
      readEnough,
    },
    soleVideo: soleVideo.slice(0, 12),
    earningNoVideo,
    mostFilmed,
    topVideosByProductEarnings,
    shelfNoVideo,
    shelfKnown,
  }
}
