// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE ADS TRYBE BRANDS RUN ON META (Seb, 2026-10-17: "do ... five", after
// TrybeDaily's "Ads Trybe brands ran on Meta"). SCOUT 1.51.0 hands MVP the
// words of each ad card it sees in Meta's public Ad Library (the same visit
// as the ad count), whether the card plays a video, and its preview picture.
// This reads those words into an ad: when it started running, the page that
// runs it, its opening line, whether it is a paid partnership with a creator.
// Kept for every member and written from the MVP team's reads only, so no
// member can put words in front of every other member. Words MVP cannot read
// stay out: an ad with no Library ID is not kept. Pure, so it is tested
// (scripts/test-trybe-board.ts).

import { openingLine } from '@/lib/trybe-working'

/** The meta table row the gallery lives in. */
export const GALLERY_KEY = 'meta_gallery'
/** Ads kept in all, the longest running first (Seb, 2026-10-24: "brands
 *  running the longest ad on meta means the video is working and the hook
 *  and cta is selling"). */
export const GALLERY_MAX = 400
/** An ad not read again in this long may have stopped, so it is let go. */
export const GALLERY_FRESH_DAYS = 60
/** Ads kept per brand. */
export const ADS_PER_BRAND = 8

export interface AdCardIn { text: string; video: boolean; preview: string | null }

export interface MetaAd {
  /** Meta's Library ID. */
  id: string
  brandId: string
  brand: string
  /** The Facebook page that runs it (a creator's page for a paid partnership). */
  page: string | null
  /** "Started running on" as Meta wrote it, and as a date (YYYY-MM-DD) when it reads as one. */
  startedText: string | null
  started: string | null
  body: string
  opening: string
  paid: boolean
  video: boolean
  versions: boolean
  preview: string | null
  readAt: string
  /** The button Meta shows ("Shop now") and the site it leads to, as Meta
   *  wrote it. Absent on ads read before 2026-10-24. */
  cta?: string | null
  link?: string | null
}

export interface Gallery {
  at: string
  /** Each brand read: its name, when, and its count of active ads then. */
  brands: Record<string, { name: string; at: string; count: number | null }>
  ads: MetaAd[]
}

const BOILER = /^(active|inactive|platforms|see ad details|see summary details|open drop-?down|this ad has multiple versions|sponsored|library id:.*|started running on.*|total active time.*|\d+ ads? use this creative and text\.?|eu transparency.*|see ad|ad details)$/i
const CTA = /^(shop now|learn more|sign up|order now|get offer|buy now|book now|download|watch more|send message|subscribe|contact us|apply now|see menu|get quote|install now|play game|listen now|get started|donate now|see more|get directions|call now|request time|use app|send whatsapp message)$/i
/** Meta writes a link's domain in capitals ("HUMEHEALTH.COM"). */
const DOMAIN = /^[A-Z0-9][A-Z0-9.-]*\.[A-Z]{2,}(\/\S*)?$/

/** A preview picture MVP will show: Meta's own image servers only. */
export function safePreview(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!/^https:\/\//i.test(s) || s.length > 1500) return null
  try {
    const h = new URL(s).hostname.toLowerCase()
    return h.endsWith('.fbcdn.net') || h === 'fbcdn.net' || h.endsWith('.facebook.com') ? s : null
  } catch { return null }
}

/** The cards SCOUT sent, read safely. Pure. */
export function readCardsBody(v: unknown): AdCardIn[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, ADS_PER_BRAND * 2).flatMap((c) => {
    if (!c || typeof c !== 'object') return []
    const o = c as Record<string, unknown>
    const text = typeof o.text === 'string' ? o.text.slice(0, 3000) : ''
    return text.trim() ? [{ text, video: o.video === true, preview: safePreview(o.preview) }] : []
  })
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 }

/** "Sep 12, 2025", "12 Sep 2025" or "September 12, 2025" as YYYY-MM-DD. Pure. */
export function adDate(text: string | null | undefined): string | null {
  const t = String(text || '').trim()
  const a = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/)
  const b = t.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/)
  const [mon, day, year] = a ? [a[1], a[2], a[3]] : b ? [b[2], b[1], b[3]] : [null, null, null]
  if (!mon) return null
  const m = MONTHS[mon.toLowerCase().slice(0, mon.toLowerCase().startsWith('sept') ? 4 : 3)]
  const d = Number(day), y = Number(year)
  if (m == null || !(d >= 1 && d <= 31) || !(y >= 2015 && y <= 2100)) return null
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** One ad from the words of its card. Null when the card has no Library ID. Pure. */
export function readAdCard(c: AdCardIn, brandId: string, brand: string, now: string): MetaAd | null {
  const lines = String(c.text || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const id = lines.map((l) => l.match(/^Library ID:\s*(\d{6,})/i)?.[1]).find(Boolean)
  if (!id) return null
  const startedText = lines.map((l) => l.match(/^Started running on\s+(.+?)(?:\s+[·•-]\s+.*)?$/i)?.[1]).find(Boolean) ?? null
  const sp = lines.findIndex((l) => /^sponsored$/i.test(l))
  let page: string | null = null
  if (sp > 0) for (let i = sp - 1; i >= 0; i--) { if (!BOILER.test(lines[i])) { page = lines[i].slice(0, 120); break } }
  const after = sp >= 0 ? lines.slice(sp + 1) : lines.filter((l) => !BOILER.test(l)).slice(page ? 1 : 0)
  const body: string[] = []
  for (const l of after) {
    if (DOMAIN.test(l) || CTA.test(l) || BOILER.test(l)) break
    if (/^paid partnership/i.test(l)) continue
    body.push(l)
    if (body.join(' ').length > 600) break
  }
  const text = body.join('\n').slice(0, 600).trim()
  // The call to action under the words: the button and the site it leads to.
  const rest = after.slice(body.length)
  const cta = rest.find((l) => CTA.test(l)) ?? null
  const link = rest.find((l) => DOMAIN.test(l))?.toLowerCase() ?? null
  return {
    id, brandId, brand, page, startedText, started: adDate(startedText), body: text, opening: text ? openingLine(text) : '',
    paid: /paid partnership/i.test(c.text), video: c.video === true, versions: /multiple versions/i.test(c.text),
    preview: c.preview ? safePreview(c.preview) : null, readAt: now,
    cta: cta ? cta.slice(0, 40) : null, link: link ? link.slice(0, 80) : null,
  }
}

/** The gallery with this brand's ads read now in place of its older ones.
 *  Ads not read again in GALLERY_FRESH_DAYS are let go (they may have
 *  stopped), and the longest running stay when there are more than
 *  GALLERY_MAX: a brand keeps paying for an ad that sells. Pure. */
export function mergeGallery(had: Gallery | null | undefined, brandId: string, brandName: string, ads: MetaAd[], count: number | null, now: string): Gallery {
  const nowT = Date.parse(now)
  const fresh = (a: MetaAd) => !Number.isFinite(nowT) || !Number.isFinite(Date.parse(a.readAt)) || nowT - Date.parse(a.readAt) < GALLERY_FRESH_DAYS * 86_400_000
  const keep = (had?.ads || []).filter((a) => a.brandId !== brandId && fresh(a))
  const mine = Array.from(new Map(ads.filter((a) => a.brandId === brandId).map((a) => [a.id, a])).values())
    .sort((a, b) => (ranDays(b) ?? -1) - (ranDays(a) ?? -1)).slice(0, ADS_PER_BRAND)
  const all = [...mine, ...keep].sort((a, b) => (ranDays(b) ?? -1) - (ranDays(a) ?? -1) || b.readAt.localeCompare(a.readAt)).slice(0, GALLERY_MAX)
  const brands = { ...(had?.brands || {}), [brandId]: { name: brandName, at: now, count } }
  return { at: now, brands, ads: all }
}

/** Days since an ad started running; null when MVP could not read the date. Pure. */
export function adDays(started: string | null | undefined, now: number): number | null {
  const t = started ? Date.parse(started) : NaN
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null
}

/** Days an ad had been running when MVP read it: Meta lists only ads that
 *  are running, so this is a fact; days since then are not. Pure. */
export function ranDays(a: Pick<MetaAd, 'started' | 'readAt'>, now = Date.now()): number | null {
  const read = Date.parse(a.readAt)
  return adDays(a.started, Number.isFinite(read) ? Math.min(read, now) : now)
}

/** The ad's closing sentence, often its offer or call to action, when it is
 *  not also its opening. Pure. */
export function closingLine(body: string): string | null {
  const parts = String(body || '').replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]*/g) || []
  const last = (parts[parts.length - 1] || '').trim()
  return parts.length > 1 && last.length > 3 ? last.slice(0, 160) : null
}

/** Ads that had run this long when read are the ones a brand keeps paying for. */
export const LONG_RUN_DAYS = 30

export interface GalleryStats { brands: number; ads: number; medianDays: number | null; paidShare: number | null; videoShare: number | null; dated: number
  /** Ads that had run LONG_RUN_DAYS or more when read. */
  longRun: number
  /** The longest running ad kept. */
  longest: { days: number; brand: string } | null }

/** Brands whose last read found ads running. Pure. */
export function brandsWithAds(g: Pick<Gallery, 'brands'> | null | undefined): number {
  return Object.values(g?.brands || {}).filter((b) => typeof b.count === 'number' && b.count > 0).length
}

/** Which Top 100 brands to read next: never read first, then the longest ago,
 *  so each press reads brands the last one did not (Seb, 2026-10-23: the
 *  button said "0 Top 100 brands" while the Top 100 was saved). Pure. */
export function nextToRead<T extends { brandId: string }>(top: T[], g: { brands?: Record<string, { at: string }> } | null | undefined, n: number): T[] {
  const at = (id: string) => g?.brands?.[id]?.at || ''
  return [...top].map((b, i) => ({ b, i })).sort((x, y) => at(x.b.brandId).localeCompare(at(y.b.brandId)) || x.i - y.i).slice(0, n).map((x) => x.b)
}

/** The four tiles: brands read, ads kept, the middle ad's age, the share of
 *  paid partnerships and of videos. A share over no ads is null, never 0%. Pure. */
export function galleryStats(ads: MetaAd[], brandsRead: number, now: number): GalleryStats {
  const days = ads.map((a) => ranDays(a, now)).filter((d): d is number => d != null).sort((a, b) => a - b)
  const median = days.length ? (days.length % 2 ? days[(days.length - 1) / 2] : Math.round((days[days.length / 2 - 1] + days[days.length / 2]) / 2)) : null
  const top = [...ads].sort((a, b) => (ranDays(b, now) ?? -1) - (ranDays(a, now) ?? -1))[0]
  const topDays = top ? ranDays(top, now) : null
  return {
    brands: brandsRead, ads: ads.length, medianDays: median, dated: days.length,
    longRun: days.filter((d) => d >= LONG_RUN_DAYS).length,
    longest: top && topDays != null ? { days: topDays, brand: top.brand } : null,
    paidShare: ads.length ? ads.filter((a) => a.paid).length / ads.length : null,
    videoShare: ads.length ? ads.filter((a) => a.video).length / ads.length : null,
  }
}

export type AdSort = 'opening' | 'longest' | 'newest'

/** Opening line first (ads with words, then the rest), running longest, or
 *  newest. Ties keep the brand together. Pure. */
export function sortAds(ads: MetaAd[], by: AdSort, now: number): MetaAd[] {
  const age = (a: MetaAd) => ranDays(a, now)
  return [...ads].sort((a, b) => {
    if (by === 'opening') return Number(!a.opening) - Number(!b.opening) || (age(b) ?? -1) - (age(a) ?? -1) || a.brand.localeCompare(b.brand)
    if (by === 'longest') return (age(b) ?? -1) - (age(a) ?? -1) || a.brand.localeCompare(b.brand)
    return (age(a) ?? 1e9) - (age(b) ?? 1e9) || a.brand.localeCompare(b.brand)
  })
}

/** An ad's page on Meta's Ad Library. */
export const adUrl = (id: string) => `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`
