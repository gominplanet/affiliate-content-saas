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
import { brandKey } from '@/lib/brand-normalize'

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

export interface AdCardIn { text: string; video: boolean; preview: string | null; /** SCOUT 1.53.9: the video file on Meta's servers. */ videoUrl?: string | null }

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
  /** The brand named in "Paid partnership with ...", for a creator's ad. */
  partner?: string | null
  /** The video file on Meta's servers (SCOUT 1.53.9), kept for listening
   *  only: Meta's links expire within days, and members are never sent it. */
  videoUrl?: string | null
  /** What the video says first, and where hearing it stands; filled in from
   *  the hooks MVP heard (HOOKS_KEY) when the gallery is read. */
  spoken?: string | null
  heard?: HeardState
}

/** Where hearing a video ad stands: its first spoken sentence is in, it says
 *  no words (music, text on screen), it is waiting its turn, Meta's link ran
 *  out before MVP listened, or SCOUT sent no file (older than 1.53.9). */
export type HeardState = 'ready' | 'none' | 'waiting' | 'gone' | 'nofile'

export interface Gallery {
  at: string
  /** Each brand read: its name, when, and its count of active ads then. */
  brands: Record<string, { name: string; at: string; count: number | null }>
  ads: MetaAd[]
}

const BOILER = /^(active|inactive|platforms|see ad details|see summary details|open drop-?down|this ad has multiple versions|sponsored|library id:.*|started running on.*|total active time.*|\d+ ads? use this creative and text\.?|eu transparency.*|see ad|ad details)$/i
const CTA = /^(shop now|learn more|sign up|order now|get offer|buy now|book now|download|watch more|send message|subscribe|contact us|apply now|see menu|get quote|install now|play game|listen now|get started|donate now|see more|get directions|call now|request time|use app|send whatsapp message)$/i
/** The video player's clock in a card's words ("0:00 / 0:43"), never the ad's. */
const PLAYER_CLOCK = /\s*\b\d{1,2}:\d{2}(?::\d{2})?\s*\/\s*\d{1,2}:\d{2}(?::\d{2})?\b/g
/** Meta writes a link's domain in capitals ("HUMEHEALTH.COM"). */
const DOMAIN = /^[A-Z0-9][A-Z0-9.-]*\.[A-Z]{2,}(\/\S*)?$/

/** A video MVP will listen to: Meta's own video servers only. */
export function safeVideoUrl(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!/^https:\/\//i.test(s) || s.length > 2000) return null
  try { const h = new URL(s).hostname.toLowerCase(); return h.endsWith('.fbcdn.net') ? s : null } catch { return null }
}

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
    return text.trim() ? [{ text, video: o.video === true, preview: safePreview(o.preview), videoUrl: o.video === true ? safeVideoUrl(o.videoUrl) : null }] : []
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
  const lines = String(c.text || '').split('\n').map((l) => l.replace(PLAYER_CLOCK, '').replace(/\s+/g, ' ').trim()).filter(Boolean)
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
    partner: lines.map((l) => l.match(/^paid partnership with\s+(.+)$/i)?.[1]).find(Boolean)?.slice(0, 120) ?? null,
    videoUrl: c.video === true ? safeVideoUrl(c.videoUrl) : null,
  }
}

// THE BRAND'S OWN ADS ONLY (Seb, 2026-10-24: "are these brands on trybe? how
// does mvp check?"). The brands come from TRYBE's own Top 100, but SCOUT finds
// their ads by searching Meta's Ad Library for the name as words, so a brand
// called Newly, Ridge or Fuego brought in a health club's, a boutique's and a
// skate shop's ads. An ad is the brand's when the page running it starts with
// the brand's name ("GloMelanin", "BYLT Basics"; not "Blue Ridge Bakery" for
// Ridge), when its site is the brand's ("humehealth.com"), or when a creator
// runs it in paid partnership with the brand. Anything else is left out.

/** Whether these words start with the brand's name, in whole words ("The" aside). Pure. */
export function startsWithBrand(text: string | null | undefined, brand: string): boolean {
  const key = brandKey(brand).replace(/^the(?=.{3})/, '')
  if (key.length < 3) return false
  const tokens = String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (tokens[0] === 'the') tokens.shift()
  let acc = ''
  for (const t of tokens) { acc += t; if (acc === key) return true; if (acc.length >= key.length) return false }
  return false
}

/** The ad is the brand's own: its page, its site, or a creator's paid partnership with it. Pure. */
export function ownAd(a: Pick<MetaAd, 'page' | 'link' | 'partner'>, brand: string): boolean {
  if (startsWithBrand(a.page, brand)) return true
  if (a.partner && startsWithBrand(a.partner, brand)) return true
  const site = String(a.link || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]
  const base = site.split('.').slice(0, -1).join('')
  const key = brandKey(brand)
  return key.length >= 3 && !!base && (base === key || base === `${key}shop` || base === `shop${key}` || base === `get${key}` || base === `try${key}`)
}

/** The gallery with this brand's ads read now in place of its older ones.
 *  Ads not read again in GALLERY_FRESH_DAYS are let go (they may have
 *  stopped), and the longest running stay when there are more than
 *  GALLERY_MAX: a brand keeps paying for an ad that sells. Pure. */
export function mergeGallery(had: Gallery | null | undefined, brandId: string, brandName: string, ads: MetaAd[], count: number | null, now: string): Gallery {
  const nowT = Date.parse(now)
  const fresh = (a: MetaAd) => !Number.isFinite(nowT) || !Number.isFinite(Date.parse(a.readAt)) || nowT - Date.parse(a.readAt) < GALLERY_FRESH_DAYS * 86_400_000
  const keep = (had?.ads || []).filter((a) => a.brandId !== brandId && fresh(a) && ownAd(a, a.brand))
  const mine = Array.from(new Map(ads.filter((a) => a.brandId === brandId && ownAd(a, a.brand || brandName)).map((a) => [a.id, a])).values())
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
  // Sentences end at . ! or ? before a space, so "straye.com" stays one word;
  // the player's clock ("0:00 / 0:43") is never part of the ad.
  const parts = String(body || '').replace(PLAYER_CLOCK, '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean)
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

// ── WHAT EACH VIDEO SAYS FIRST (Seb, 2026-10-24: "yes build that") ────────────
// The caption's first line is not the hook: the hook is what the video says.
// SCOUT 1.53.9 hands MVP each video's file on Meta's servers, and MVP listens
// to it (lib/meta-ad-hear, every 20 minutes and on the team's press), longest
// running first. What it heard is kept apart from the gallery, by Meta's ad
// ID, so a listen never races a read of the ads.

/** The meta table row the heard hooks live in. */
export const HOOKS_KEY = 'meta_ad_hooks'
/** Listens a day, the team's presses included. */
export const META_LISTEN_DAILY = 200
/** Heard hooks kept, the ads in the gallery first. */
const HOOKS_MAX = 1500
/** A link with no expiry of its own is trusted this long after the read. */
const LINK_FRESH_MS = 2 * 86_400_000

export interface AdHook { hook: string | null; script: string | null; state: 'ready' | 'none' | 'failed'; why?: string | null; at: string; tries: number }
export type AdHooks = Record<string, AdHook>

/** When Meta's link to a file stops working: its `oe` (hex seconds), else
 *  two days after the read. Pure. */
export function linkExpiresAt(url: string, readAt: string): number {
  try {
    const oe = new URL(url).searchParams.get('oe')
    const t = oe && /^[0-9a-f]{6,10}$/i.test(oe) ? parseInt(oe, 16) * 1000 : NaN
    if (Number.isFinite(t)) return t
  } catch { /* the read's age instead */ }
  const r = Date.parse(readAt)
  return Number.isFinite(r) ? r + LINK_FRESH_MS : 0
}

/** Where hearing this ad stands. Pure. */
export function heardState(a: MetaAd, hooks: AdHooks, now: number): HeardState {
  const h = hooks[a.id]
  if (h?.state === 'ready') return 'ready'
  if (h?.state === 'none') return 'none'
  if (!a.videoUrl) return 'nofile'
  return linkExpiresAt(a.videoUrl, a.readAt) - 10 * 60_000 > now ? 'waiting' : 'gone'
}

/** The video ads to listen to next: a file whose link still works, not heard
 *  yet (one that failed gets one more try), longest running first. Pure. */
export function toHear(ads: MetaAd[], hooks: AdHooks, now: number, n: number): MetaAd[] {
  return ads
    .filter((a) => a.video && a.videoUrl && heardState(a, hooks, now) === 'waiting' && (hooks[a.id]?.tries ?? 0) < 2)
    .sort((a, b) => (ranDays(b, now) ?? -1) - (ranDays(a, now) ?? -1))
    .slice(0, Math.max(0, n))
}

/** The hooks with these new ones in, the gallery's first, at most HOOKS_MAX. Pure. */
export function mergeHooks(had: AdHooks | null | undefined, add: AdHooks, inGallery: Set<string>): AdHooks {
  const all = { ...(had || {}), ...add }
  const ids = Object.keys(all).sort((a, b) => Number(inGallery.has(b)) - Number(inGallery.has(a)) || (all[b].at || '').localeCompare(all[a].at || ''))
  return Object.fromEntries(ids.slice(0, HOOKS_MAX).map((id) => [id, all[id]]))
}

/** Ads as members get them: what each says first and where hearing stands,
 *  with Meta's file link left out. Pure. */
export function withHooks(ads: MetaAd[], hooks: AdHooks, now: number): MetaAd[] {
  return ads.map(({ videoUrl, ...a }) => {
    if (!a.video) return a
    const state = heardState({ ...a, videoUrl }, hooks, now)
    return { ...a, heard: state, spoken: state === 'ready' ? hooks[a.id]?.hook ?? null : null }
  })
}
