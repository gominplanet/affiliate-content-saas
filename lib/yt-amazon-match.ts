// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUTUBE AGAINST AMAZON (Seb, 2026-11-11: "is there a way to look at all of
// the youtube videos ive uploaded and see what is missing when you look at my
// amazon storefront?"). An Amazon video does not say which YouTube video it
// came from, so the two are matched by product: the ASINs each YouTube video
// links to (title and description, short links followed by the route) against
// the products on each Amazon video. Four lists:
//
//   missing      on YouTube, and no Amazon video shows that product yet
//                (one Amazon rejected is said, and still counts as missing)
//   both         an Amazon video shows a product the YouTube video links to
//   unknown      MVP could not tell which product the YouTube video is about,
//                with why (no product link, links led elsewhere, not read yet)
//   amazonOnly   an Amazon video whose products no YouTube video links to
//
// A link in most descriptions (a gear list, a storefront's favourite) is not
// what one video is about: an ASIN linked from more than max(6, 8%) of the
// videos, and never in a title, is left out of the matching and named.
//
// Amazon videos whose products MVP has not read yet are counted apart, never
// put in a list they may not belong in. Pure.

export interface YtVideo {
  id: string
  title: string
  publishedAt: string | null
  views: number | null
  thumb: string | null
  short: boolean
  /** When its links were read; null means not read yet. */
  readAt: string | null
  /** Why no product was found, when none was. */
  why: string | null
}

export interface AmzVideo {
  aci: string
  description: string | null
  state: string | null
  publishedAt: string | null
  views: number | null
  /** MVP has read which products this video shows. */
  productsRead: boolean
}

export type AmzState = 'live' | 'review' | 'rejected'

/** Amazon's own state word, sorted: rejected, still in review, or live. */
export function amazonState(state: string | null): AmzState {
  const s = String(state || '')
  if (/reject|declin|remov|suppress|fail/i.test(s)) return 'rejected'
  if (/process|pending|review|draft|upload/i.test(s)) return 'review'
  return 'live'
}

/** ASINs written in a title: only the B0 form, so a model number is never taken for one. */
export function titleAsins(title: string): string[] {
  return Array.from(new Set((String(title || '').toUpperCase().match(/\bB0[A-Z0-9]{8}\b/g) || [])))
}

/** Why a YouTube video has no product, in words. */
export function whyWords(v: Pick<YtVideo, 'readAt' | 'why'>): string {
  if (!v.readAt) return 'Not read yet. Press Find the products.'
  const w = String(v.why || '')
  if (w === 'no-link') return 'No Amazon or product link in its title or description.'
  if (w === 'amazon-not-product') return 'Its Amazon links go to a storefront or search, not one product.'
  if (w.startsWith('elsewhere:')) return `Its links lead to ${w.slice(10).split(',').filter(Boolean).slice(0, 3).join(', ')}, not to Amazon.`
  if (w === 'link-failed') return 'Its links did not answer when MVP followed them. Press Read again later.'
  return w || 'No product found in its links.'
}

export interface Coverage {
  missing: Array<{ yt: YtVideo; asins: string[]; rejected: AmzVideo[] }>
  both: Array<{ yt: YtVideo; asins: string[]; amazon: AmzVideo[] }>
  unknown: Array<{ yt: YtVideo; why: string }>
  amazonOnly: Array<{ amz: AmzVideo; products: Array<{ asin: string; title: string | null }> }>
  /** ASINs in most descriptions, left out of the matching, with how many videos link each. */
  common: Array<{ asin: string; videos: number }>
  counts: {
    youtube: number
    youtubeRead: number
    amazon: number
    amazonUnread: number
    amazonNoProduct: number
    missing: number
    both: number
    unknown: number
    amazonOnly: number
  }
}

/** The four lists. Bigger videos first: they are worth the most. Pure. */
export function buildCoverage(
  yt: YtVideo[],
  ytProducts: Array<{ videoId: string; asin: string; via?: string | null }>,
  amz: AmzVideo[],
  amzProducts: Array<{ aci: string; asin: string; title: string | null }>,
): Coverage {
  // The links in most descriptions.
  const linkedBy = new Map<string, Set<string>>()
  const inTitle = new Set<string>()
  for (const p of ytProducts) {
    if (p.via === 'title') inTitle.add(p.asin)
    const s = linkedBy.get(p.asin) || new Set<string>(); s.add(p.videoId); linkedBy.set(p.asin, s)
  }
  const often = Math.max(6, Math.ceil(yt.length * 0.08))
  const common = Array.from(linkedBy, ([asin, s]) => ({ asin, videos: s.size })).filter((x) => x.videos > often && !inTitle.has(x.asin)).sort((a, b) => b.videos - a.videos)
  const isCommon = new Set(common.map((x) => x.asin))
  const asinsOf = new Map<string, string[]>()
  const hadCommonOnly = new Set<string>()
  for (const p of ytProducts) {
    if (isCommon.has(p.asin)) { if (!asinsOf.has(p.videoId)) hadCommonOnly.add(p.videoId); continue }
    hadCommonOnly.delete(p.videoId)
    const a = asinsOf.get(p.videoId) || []; if (!a.includes(p.asin)) a.push(p.asin); asinsOf.set(p.videoId, a)
  }
  const amzBy = new Map(amz.map((v) => [v.aci, v]))
  const amzOfAsin = new Map<string, AmzVideo[]>()
  const productsOf = new Map<string, Array<{ asin: string; title: string | null }>>()
  for (const p of amzProducts) {
    const v = amzBy.get(p.aci)
    if (!v) continue
    const list = amzOfAsin.get(p.asin) || []
    if (!list.includes(v)) list.push(v)
    amzOfAsin.set(p.asin, list)
    const ps = productsOf.get(p.aci) || []
    if (!ps.some((x) => x.asin === p.asin)) ps.push({ asin: p.asin, title: p.title })
    productsOf.set(p.aci, ps)
  }
  const byViews = (a: { views: number | null }, b: { views: number | null }) => (b.views ?? -1) - (a.views ?? -1)
  const missing: Coverage['missing'] = []
  const both: Coverage['both'] = []
  const unknown: Coverage['unknown'] = []
  const ytAsins = new Set<string>()
  for (const v of yt) {
    const asins = asinsOf.get(v.id) || []
    for (const a of asins) ytAsins.add(a)
    if (!asins.length) { unknown.push({ yt: v, why: hadCommonOnly.has(v.id) ? 'Its only product links are the ones in most of your descriptions (a gear list?), so MVP cannot tell which product this video is about.' : whyWords(v) }); continue }
    const on = asins.flatMap((a) => amzOfAsin.get(a) || [])
    const showing = Array.from(new Set(on.filter((x) => amazonState(x.state) !== 'rejected')))
    if (showing.length) both.push({ yt: v, asins, amazon: showing })
    else missing.push({ yt: v, asins, rejected: Array.from(new Set(on)) })
  }
  const amazonOnly: Coverage['amazonOnly'] = []
  let amazonUnread = 0
  let amazonNoProduct = 0
  for (const v of amz) {
    if (amazonState(v.state) === 'rejected') continue
    if (!v.productsRead) { amazonUnread++; continue }
    const products = productsOf.get(v.aci) || []
    if (!products.length) { amazonNoProduct++; continue }
    if (!products.some((p) => ytAsins.has(p.asin))) amazonOnly.push({ amz: v, products })
  }
  missing.sort((a, b) => byViews(a.yt, b.yt))
  both.sort((a, b) => byViews(a.yt, b.yt))
  unknown.sort((a, b) => byViews(a.yt, b.yt))
  amazonOnly.sort((a, b) => byViews(a.amz, b.amz))
  return {
    missing, both, unknown, amazonOnly, common,
    counts: {
      youtube: yt.length, youtubeRead: yt.filter((v) => v.readAt).length,
      amazon: amz.length, amazonUnread, amazonNoProduct,
      missing: missing.length, both: both.length, unknown: unknown.length, amazonOnly: amazonOnly.length,
    },
  }
}

/** One list as plain lines, for Copy list. Pure. */
export function listText(c: Coverage, which: 'missing' | 'amazonOnly' | 'unknown'): string {
  if (which === 'missing') return c.missing.map((m) => `${m.yt.title}\thttps://www.youtube.com/watch?v=${m.yt.id}\t${m.asins.join(' ')}`).join('\n')
  if (which === 'unknown') return c.unknown.map((m) => `${m.yt.title}\thttps://www.youtube.com/watch?v=${m.yt.id}\t${m.why}`).join('\n')
  return c.amazonOnly.map((m) => `${(m.amz.description || '').split('\n')[0].slice(0, 120)}\t${m.products.map((p) => p.asin).join(' ')}`).join('\n')
}
