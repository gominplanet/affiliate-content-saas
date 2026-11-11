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

/** THE PRODUCT LINKS AT THE TOP OF A DESCRIPTION (Seb, 2026-11-11: "most
 *  youtube videos have links in their description.. that is where you will
 *  find the product"). A review's own product link sits at the top ("CHECK OUT
 *  TODAY'S PRICE: https://geni.us/pbKL5 (Amazon link)"); below a separator or
 *  a heading come the standing links (RESOURCES, WHAT WE SHOOT REVIEWS WITH,
 *  gear, socials) that every description repeats. Only the top block is
 *  followed, so thousands of gear links are not. Pure. */
export function topLinks(description: string, max = 5): string[] {
  const out: string[] = []
  for (const line of String(description || '').split('\n')) {
    const t = line.trim()
    if (out.length && (/^([-\u2013\u2014_=.*~\u2022\u25ba]\s*){1,}$/.test(t) || /^(disclaimer|resources|what we|our fav|my gear|gear|equipment|follow|connect|music|social|chapters|timestamps|links|support)/i.test(t.replace(/^[^a-z0-9]+/i, '')))) break
    for (const u of t.match(/https?:\/\/[^\s)>\]"'\u25ba]+/gi) || []) { out.push(u.replace(/[.,;:!]+$/, '')); if (out.length >= max) return out }
  }
  return out
}

/** A title, as a key that survives punctuation, emoji, hashtags and case. Pure. */
export function titleKey(s: string): string {
  return String(s || '').split('\n')[0].normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/#[\w-]+/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 200)
}
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'my', 'your', 'our', 'is', 'it', 'this', 'that', 'with', 'vs', 'review', 'reviews', 'honest', 'really', 'worth', 'it', 'test', 'tested', 'best', 'new', 'how', 'why', 'what', 'does', 'do', 'you', 'we', 'i', 'me', 'after', 'from', 'by', 'at', 'be', 'can', 'are', 'buy', 'should', 'amazon', 'find', 'finds', 'must', 'have', 'shorts'])
const tokens = (key: string) => new Set(key.split(' ').filter((w) => w.length > 1 && !STOP.has(w)))

/** Amazon videos whose own words carry this YouTube title: the same title, or
 *  nearly the same words (at least three, and 70 percent shared). Pure. */
export function titleMatcher(amz: AmzVideo[]): (title: string) => AmzVideo[] {
  const byKey = new Map<string, AmzVideo[]>()
  const toks = new Map<AmzVideo, Set<string>>()
  const index = new Map<string, AmzVideo[]>()
  for (const v of amz) {
    const k = titleKey(v.description || '')
    if (k.length < 8) continue
    const l = byKey.get(k) || []; l.push(v); byKey.set(k, l)
    const t = tokens(k)
    toks.set(v, t)
    for (const w of t) { const x = index.get(w) || []; x.push(v); index.set(w, x) }
  }
  return (title: string) => {
    const k = titleKey(title)
    if (k.length < 8) return []
    const exact = byKey.get(k)
    if (exact) return exact
    const mine = tokens(k)
    if (mine.size < 3) return []
    // Candidates share one of the title's rarer words.
    const rare = Array.from(mine).filter((w) => (index.get(w)?.length ?? 0) > 0).sort((a, b) => index.get(a)!.length - index.get(b)!.length).slice(0, 3)
    const seen = new Set<AmzVideo>()
    let best = 0
    let hits: AmzVideo[] = []
    for (const w of rare) for (const v of index.get(w)!.slice(0, 200)) {
      if (seen.has(v)) continue
      seen.add(v)
      const t = toks.get(v)!
      let both = 0
      for (const x of mine) if (t.has(x)) both++
      const score = both / (mine.size + t.size - both)
      if (both < 3 || score < 0.7) continue
      if (score > best) { best = score; hits = [v] } else if (score === best) hits.push(v)
    }
    return hits
  }
}

/** Why a YouTube video has no product, in words. */
export function whyWords(v: Pick<YtVideo, 'readAt' | 'why'>): string {
  if (!v.readAt) return 'Not read yet. Press Find the products.'
  const w = String(v.why || '')
  if (w === 'no-link') return 'No Amazon or product link in its title or description.'
  if (w === 'amazon-not-product') return 'Its Amazon links go to a storefront or search, not one product.'
  if (w.startsWith('elsewhere:')) return `Its links lead to ${w.slice(10).split(',').filter(Boolean).slice(0, 3).join(', ')}, not to Amazon.`
  if (w === 'link-failed') return 'Its product link did not answer when MVP followed it. Check everything tries it again.'
  if (w === 'rate-limited') return 'The link service asked MVP to slow down before this link was read. Check everything tries it again.'
  return w || 'No product found in its links.'
}

export interface Coverage {
  missing: Array<{ yt: YtVideo; asins: string[]; rejected: AmzVideo[] }>
  /** byTitle: paired by the words of the title, not by a product link. */
  both: Array<{ yt: YtVideo; asins: string[]; amazon: AmzVideo[]; byTitle?: boolean }>
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
    bothByTitle: number
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
  // THE SAME VIDEO BY ITS TITLE (2026-11-11): an Amazon video's own words are
  // often the YouTube title, so the two pair even when no link could be read.
  const sameTitle = titleMatcher(amz.filter((x) => amazonState(x.state) !== 'rejected'))
  const pairedByTitle = new Set<AmzVideo>()
  for (const v of yt) {
    const asins = asinsOf.get(v.id) || []
    for (const a of asins) ytAsins.add(a)
    const on = asins.flatMap((a) => amzOfAsin.get(a) || [])
    const showing = Array.from(new Set(on.filter((x) => amazonState(x.state) !== 'rejected')))
    if (showing.length) { both.push({ yt: v, asins, amazon: showing }); continue }
    const titled = sameTitle(v.title)
    if (titled.length) {
      for (const t of titled) pairedByTitle.add(t)
      const theirs = Array.from(new Set(titled.flatMap((t) => (productsOf.get(t.aci) || []).map((p) => p.asin))))
      both.push({ yt: v, asins: asins.length ? asins : theirs, amazon: titled, byTitle: true })
      continue
    }
    if (!asins.length) { unknown.push({ yt: v, why: hadCommonOnly.has(v.id) ? 'Its only product links are the ones in most of your descriptions (a gear list?), so MVP cannot tell which product this video is about.' : whyWords(v) }); continue }
    missing.push({ yt: v, asins, rejected: Array.from(new Set(on)) })
  }
  const amazonOnly: Coverage['amazonOnly'] = []
  let amazonUnread = 0
  let amazonNoProduct = 0
  for (const v of amz) {
    if (amazonState(v.state) === 'rejected') continue
    if (pairedByTitle.has(v)) continue
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
      missing: missing.length, both: both.length, bothByTitle: both.filter((b) => b.byTitle).length, unknown: unknown.length, amazonOnly: amazonOnly.length,
    },
  }
}

/** One list as plain lines, for Copy list. Pure. */
export function listText(c: Coverage, which: 'missing' | 'amazonOnly' | 'unknown'): string {
  if (which === 'missing') return c.missing.map((m) => `${m.yt.title}\thttps://www.youtube.com/watch?v=${m.yt.id}\t${m.asins.join(' ')}`).join('\n')
  if (which === 'unknown') return c.unknown.map((m) => `${m.yt.title}\thttps://www.youtube.com/watch?v=${m.yt.id}\t${m.why}`).join('\n')
  return c.amazonOnly.map((m) => `${(m.amz.description || '').split('\n')[0].slice(0, 120)}\t${m.products.map((p) => p.asin).join(' ')}`).join('\n')
}
