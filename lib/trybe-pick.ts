// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH TRYBE BRANDS ARE WORTH IT (Cole Schwartz on Oink, 2026-10-09; Seb
// 2026-10-12: "do 1, 2, 3, 4"). Cole earns $19K a month on TRYBE. How he picks:
//   - few creators: "only have like one or two, three creators... you get their
//     whole budget"; a brand with 1,500 creators is "too competitive";
//   - real ad spend: a brand he sees "in [the Top 100] multiple times... they're
//     spending a good amount of money"; he also asks brands what they spend;
//   - not on TikTok: "I actually prefer brands that are not on TikTok and are
//     only on Trybe... less competition".
// MVP reads each of those: the creator count TRYBE lists, how many active Meta
// ads mention the brand (SCOUT reads Meta's Ad Library), how often the brand is
// in TRYBE's Top 100 right now, what TRYBE says creators earn there, and
// whether its own website links a TikTok Shop. A signal MVP has not read is
// said as not read, never scored as zero. Pure, so it is tested
// (scripts/test-trybe-playbook).

import { brandKey } from '@/lib/brand-normalize'

export type Tone = 'good' | 'bad' | 'info'
export interface PickReason { text: string; tone: Tone }

export interface PickInput {
  totalCreators: number | null
  /** Active Meta ads mentioning the brand; null when not read. */
  metaAds: number | null
  metaAdsCheckedAt?: string | null
  /** Times in TRYBE's Top 100 now; null when the Top 100 was not read. */
  top100Hits: number | null
  top100BestRank?: number | null
  /** TikTok on its own website: null when the website was not checked. */
  tiktokShop: boolean | null
  tiktokHandle?: string | null
  /** TRYBE's own words for what creators earn with the brand. */
  earningsBucket?: string | null
  /** The % of sales it pays, when its pay is a percent (Lukas Pakter, TRYBE's
   *  co-founder, 2026-07: good brands pay 10% or more). */
  commissionPct?: number | null
  /** What its TRYBE page and website say about how it treats creators. */
  program?: CreatorProgram | null
  /** Dollars per approved video (lib/trybe-pay estimatePay), when known. */
  perVideo?: number | null
  /** Where that figure comes from: your results, members', or its terms. */
  perVideoBasis?: 'yours' | 'members' | 'terms' | 'variable' | 'unknown' | null
  /** It pays a guaranteed retainer. */
  guaranteed?: boolean
  /** How crowded it is (lib/trybe-finder crowdOf). */
  crowd?: 'open' | 'filling' | 'crowded' | null
  /** It takes statics (photo ads), from its own words; null when it does not say. */
  statics?: boolean | null
  /** Whether it sends samples, when TRYBE says. */
  samples?: boolean | null
  /** Days since it joined TRYBE, when TRYBE says. */
  daysOnTrybe?: number | null
  /** What TRYBE says it has paid creators in all, in dollars. */
  paidOut?: number | null
  /** The brand on Amazon (lib/trybe-finder amazonOf): videos the creator
   *  already made of its products, and its Creator Connections campaigns. */
  amazon?: { yourVideos: number; ccCampaigns: number; ccBestPct: number | null; storefront: number } | null
}

/** What a creator can say matters to them (Seb, 2026-10-14, after Rob's Oink
 *  Blue video: "build all 4"). Each part of the score belongs to one. */
export type Factor = 'competition' | 'adSpend' | 'perVideo' | 'percent' | 'paysCreators' | 'samples' | 'newBrand' | 'amazon' | 'program' | 'statics'
export const FACTORS: Array<{ id: Factor; label: string; says: string }> = [
  { id: 'competition', label: 'Few creators', says: 'Fewer creators means more of the budget for you. Not on TikTok Shop counts here too.' },
  { id: 'adSpend', label: 'Spends on ads', says: 'Meta ads running now and videos in TRYBE\u2019s Top 100.' },
  { id: 'perVideo', label: 'Pay per video', says: 'A flat fee for each approved video.' },
  { id: 'percent', label: '% of sales', says: 'A share of every sale your videos make.' },
  { id: 'paysCreators', label: 'Has paid creators', says: 'What TRYBE says creators have earned with it.' },
  { id: 'samples', label: 'Sends samples', says: 'So you do not buy the product to film it.' },
  { id: 'newBrand', label: 'New on TRYBE', says: 'Joined in the last month: few creators have found it yet.' },
  { id: 'amazon', label: 'On Amazon too', says: 'Videos you already made of its products, and its Creator Connections campaigns.' },
  { id: 'program', label: 'Looks after creators', says: 'Retainers, calls and briefs, from its own words.' },
  { id: 'statics', label: 'Takes statics', says: 'Brands that also take photo (static) ads, from their own words. Set by What you make.' },
]
/** What you make (Oink's Videos, Statics or Both): the weight of 'statics'. */
export const FORMATS: Array<{ w: Weight; label: string; says: string }> = [
  { w: 0, label: 'Videos', says: 'You film videos: statics do not count.' },
  { w: 1, label: 'Videos and statics', says: 'Brands that also take statics rank a little higher.' },
  { w: 2, label: 'Mostly statics', says: 'Brands that take statics rank first.' },
]
/** Factors set in Your priorities' grid; statics is set by What you make. */
export const GRID_FACTORS = FACTORS.filter((f) => f.id !== 'statics')
/** 0: does not matter, 1: normal, 2: matters a lot. */
export type Weight = 0 | 1 | 2
export type Priorities = Record<Factor, Weight>
export const DEFAULT_PRIORITIES: Priorities = { competition: 1, adSpend: 1, perVideo: 1, percent: 1, paysCreators: 1, samples: 1, newBrand: 1, amazon: 1, program: 1, statics: 0 }

/** A saved priorities object, read safely: anything missing or odd is normal. Pure. */
export function readPriorities(v: unknown): Priorities {
  const out: Priorities = { ...DEFAULT_PRIORITIES }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const f of FACTORS) { const w = (v as Record<string, unknown>)[f.id]; if (w === 0 || w === 1 || w === 2) out[f.id] = w }
  }
  return out
}

/** The pick score with the creator's own priorities: each part times its
 *  weight. All normal gives the plain score. Pure. */
export function weighScore(p: Pick, pr: Priorities): number {
  let n = 0
  for (const [f, v] of Object.entries(p.parts) as Array<[Factor, number]>) n += v * (pr[f] ?? 1)
  return n
}

/** How a brand invests in its creators, from its own words (Lukas: the brands
 *  worth the volume pay retainers, run calls and a Discord, and some only take
 *  creators through their Discord). */
export interface CreatorProgram { retainer: boolean; coaching: boolean; discord: boolean }

/** Reads it from a brand's TRYBE description and website text. Pure. */
export function creatorProgramOf(text: string | null | undefined): CreatorProgram {
  const t = String(text || '').toLowerCase()
  return {
    retainer: /\bretainers?\b|monthly (?:creator )?(?:pay|stipend)|base pay|guaranteed pay/.test(t),
    coaching: /\b(weekly|creator|group|coaching|1:1|one[- ]on[- ]one|training) calls?\b|\bcreator coaching\b|\bwe (?:train|coach)\b|\bcreative briefs?\b|\bcreator (?:community|program)\b/.test(t),
    discord: /\bdiscord\b/.test(t),
  }
}

/** Whether a brand takes statics (photo ads), from its TRYBE entry's format
 *  fields or its own description. True or not said (null): never "no", since
 *  a brand that does not mention them may still take them. Pure. */
export function staticsOf(raw: unknown, about: string | null | undefined): boolean | null {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const fields = ['contentTypes', 'acceptedContentTypes', 'formats', 'contentFormats', 'mediaTypes', 'assetTypes']
  for (const k of fields) {
    const v = o[k]
    const list = Array.isArray(v) ? v.map((x) => String(typeof x === 'object' && x ? (x as Record<string, unknown>).name ?? (x as Record<string, unknown>).value ?? '' : x)) : typeof v === 'string' ? [v] : []
    if (list.some((x) => /static|image|photo|carousel/i.test(x))) return true
  }
  const t = String(about || '').toLowerCase()
  if (/\bstatics?\b(?! electricity)|\bstatic (?:ads?|images?|content|creatives?|posts?)\b|\bimage ads?\b|\bphoto ads?\b|\bugc photos?\b|\bproduct photos? (?:and|or|&) videos?\b|\bphotos? (?:and|or|&) videos?\b|\bvideos? (?:and|or|&) (?:photos?|images?|statics?)\b/.test(t)) return true
  return null
}

export interface Pick { score: number; reasons: PickReason[]; read: number; parts: Partial<Record<Factor, number>> }

/** Meta ads are read again after a week. */
export const META_ADS_FRESH_MS = 7 * 86_400_000
/** The Top 100 is read again after a day. */
export const TOP100_FRESH_MS = 20 * 3600_000

/** Dollars from TRYBE's earnings bucket ("$10K - $50K", "50k+", "$1,000+"):
 *  the lower end, so a range is never read as more than it promises. */
export function bucketDollars(raw: string | null | undefined): number | null {
  const s = String(raw || '').toLowerCase().replace(/,/g, '')
  const m = s.match(/\$?\s*(\d+(?:\.\d+)?)\s*([km])?/)
  if (!m) return null
  const n = parseFloat(m[1]) * (m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1)
  return Number.isFinite(n) && n > 0 ? n : null
}

const fmt = (n: number) => n >= 1_000_000 ? `$${Math.round(n / 100_000) / 10}M` : n >= 1_000 ? `$${Math.round(n / 100) / 10}K` : `$${n}`

/** The pick score: higher is a better bet, by Cole's rules. Each point is
 *  booked to the factor it comes from, so a creator's priorities can weigh
 *  it (weighScore). Pure. */
export function pickScore(p: PickInput): Pick {
  let read = 0
  const reasons: PickReason[] = []
  const parts: Partial<Record<Factor, number>> = {}
  const add = (f: Factor, n: number) => { parts[f] = (parts[f] ?? 0) + n }
  const c = p.totalCreators
  if (typeof c === 'number' && Number.isFinite(c)) {
    read++
    if (c === 0) { add('competition', 35); reasons.push({ text: 'No creators yet: the whole budget is open', tone: 'good' }) }
    else if (c <= 5) { add('competition', 35); reasons.push({ text: `Only ${c} creator${c === 1 ? '' : 's'}: you share the budget with almost nobody`, tone: 'good' }) }
    else if (c <= 20) { add('competition', 25); reasons.push({ text: `${c} creators: little competition`, tone: 'good' }) }
    else if (c <= 60) { add('competition', 12); reasons.push({ text: `${c} creators`, tone: 'info' }) }
    else if (c >= 500) { add('competition', -20); reasons.push({ text: `${c.toLocaleString()} creators: crowded, the budget is split many ways`, tone: 'bad' }) }
    else if (c >= 200) { add('competition', -8); reasons.push({ text: `${c} creators: busy`, tone: 'info' }) }
  }
  if (typeof p.metaAds === 'number') {
    read++
    const n = p.metaAds
    if (n >= 50) { add('adSpend', 30); reasons.push({ text: `${n.toLocaleString()} Meta ads running now: real ad spend`, tone: 'good' }) }
    else if (n >= 10) { add('adSpend', 20); reasons.push({ text: `${n} Meta ads running now`, tone: 'good' }) }
    else if (n >= 1) { add('adSpend', 8); reasons.push({ text: `${n} Meta ad${n === 1 ? '' : 's'} running now`, tone: 'info' }) }
    else { add('adSpend', -15); reasons.push({ text: 'No Meta ads running now', tone: 'bad' }) }
  }
  if (typeof p.top100Hits === 'number') {
    read++
    const h = p.top100Hits
    if (h >= 3) { add('adSpend', 25); reasons.push({ text: `${h} videos in TRYBE's Top 100 now: it is spending`, tone: 'good' }) }
    else if (h >= 1) { add('adSpend', 15); reasons.push({ text: `In TRYBE's Top 100 now${p.top100BestRank ? ` (#${p.top100BestRank})` : ''}`, tone: 'good' }) }
  }
  const earned = bucketDollars(p.earningsBucket)
  if (earned != null) {
    read++
    if (earned >= 10_000) { add('paysCreators', 12); reasons.push({ text: `Creators have earned ${fmt(earned)}+ with it`, tone: 'good' }) }
    else if (earned >= 1_000) { add('paysCreators', 5); reasons.push({ text: `Creators have earned ${fmt(earned)}+ with it`, tone: 'info' }) }
  } else if (typeof p.paidOut === 'number' && p.paidOut > 0) {
    read++
    add('paysCreators', p.paidOut >= 10_000 ? 12 : p.paidOut >= 1_000 ? 5 : 2)
    reasons.push({ text: `Has paid creators ${fmt(Math.round(p.paidOut))} on TRYBE`, tone: p.paidOut >= 1_000 ? 'good' : 'info' })
  }
  const pct = p.commissionPct
  if (typeof pct === 'number' && pct > 0) {
    read++
    if (pct >= 10) { add('percent', 12); reasons.push({ text: `Pays ${pct}% of sales: enough to make the volume worth it`, tone: 'good' }) }
    else if (pct < 5) { add('percent', -8); reasons.push({ text: `Pays ${pct}% of sales: low for the 30 or more videos a month it takes`, tone: 'bad' }) }
    else { add('percent', 0); reasons.push({ text: `Pays ${pct}% of sales`, tone: 'info' }) }
  }
  const fee = p.perVideo
  if (typeof fee === 'number' && fee > 0) {
    read++
    const d = fee % 1 ? fee.toFixed(2) : String(fee)
    const said = p.perVideoBasis === 'yours' ? `You earn $${d} per approved video with it`
      : p.perVideoBasis === 'members' ? `Members earn about $${d} per approved video`
        : `$${d} per video`
    if (fee >= 50) { add('perVideo', 15); reasons.push({ text: said, tone: 'good' }) }
    else if (fee >= 20) { add('perVideo', 8); reasons.push({ text: said, tone: 'good' }) }
    else { add('perVideo', 3); reasons.push({ text: said, tone: 'info' }) }
  }
  if (p.guaranteed) { add('perVideo', 6); reasons.push({ text: 'Guaranteed pay (a retainer)', tone: 'good' }) }
  // OPEN, FILLING, CROWDED adds to the creator count, which is already scored:
  // only a brand filling fast or crowded by output moves it.
  if (p.crowd === 'filling' && typeof c === 'number' && c < 40) { add('competition', -6); reasons.push({ text: 'Filling: creators are joining fast', tone: 'info' }) }
  else if (p.crowd === 'crowded' && typeof c === 'number' && c < 150) { add('competition', -10); reasons.push({ text: 'Crowded: many videos in the last 30 days', tone: 'bad' }) }
  if (p.samples === true) { add('samples', 6); reasons.push({ text: 'Sends samples', tone: 'good' }) }
  else if (p.samples === false) { add('samples', -4); reasons.push({ text: 'No samples: you buy the product to film it', tone: 'info' }) }
  if (typeof p.daysOnTrybe === 'number' && p.daysOnTrybe >= 0) {
    if (p.daysOnTrybe <= 30) { add('newBrand', 8); reasons.push({ text: `New on TRYBE: ${p.daysOnTrybe} day${p.daysOnTrybe === 1 ? '' : 's'}`, tone: 'good' }) }
    else add('newBrand', 0)
  }
  const amz = p.amazon
  if (amz) {
    if (amz.yourVideos > 0) { add('amazon', 20); reasons.push({ text: `You already have ${amz.yourVideos} Amazon video${amz.yourVideos === 1 ? '' : 's'} of its products`, tone: 'good' }) }
    else if (amz.storefront > 0) { add('amazon', 10); reasons.push({ text: `${amz.storefront} of its products in your Amazon storefront`, tone: 'good' }) }
    if (amz.ccCampaigns > 0) { add('amazon', 6); reasons.push({ text: `Pays Amazon creators too (Creator Connections${amz.ccBestPct ? `, up to ${amz.ccBestPct}%` : ''})`, tone: 'good' }) }
  }
  if (p.program) {
    if (p.program.retainer) { add('program', 10); reasons.push({ text: 'Mentions retainers for creators', tone: 'good' }) }
    if (p.program.coaching) { add('program', 6); reasons.push({ text: 'Trains its creators (calls, briefs or a creator program)', tone: 'good' }) }
    if (p.program.discord) reasons.push({ text: 'Has a Discord: brands like this often pick creators there, so join it too', tone: 'info' })
  }
  if (p.statics === true) { add('statics', 10); reasons.push({ text: 'Takes statics (photo ads)', tone: 'good' }) }
  if (p.tiktokShop === true) { read++; add('competition', -10); reasons.push({ text: 'Sells on TikTok Shop too: more creators competing', tone: 'bad' }) }
  else if (p.tiktokShop === false) {
    read++
    if (p.tiktokHandle) reasons.push({ text: 'On TikTok, no TikTok Shop found on its website', tone: 'info' })
    else { add('competition', 8); reasons.push({ text: 'Not on TikTok (from its website): less competition', tone: 'good' }) }
  }
  const score = Object.values(parts).reduce((n: number, v) => n + (v ?? 0), 0)
  return { score, reasons, read, parts }
}

// ── Reading the signals ──────────────────────────────────────────────────────

/** TikTok on a brand's home page: an account link, and whether it sells on
 *  TikTok Shop. Pure. */
export function siteSocials(html: string): { tiktokHandle: string | null; tiktokShop: boolean } {
  const s = String(html || '')
  const handle = s.match(/tiktok\.com\/@([A-Za-z0-9._]{2,24})/i)?.[1] || null
  const shop = /shop\.tiktok\.com|tiktok\.com\/(?:view\/)?shop\b|\btiktok\s*shop\b|\btiktokshop\b/i.test(s)
  return { tiktokHandle: handle, tiktokShop: shop }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

export interface TopEntry { brandId: string | null; brandName: string | null; rank: number | null }

/** TRYBE's Top 100 (GET /backend/api/creator/v2/top-creatives), one entry per
 *  video. Field names seen only in TRYBE's page code (rank, submissionId), so
 *  the brand is found under any of the names it is likely to have. */
export function readTopCreatives(json: unknown): TopEntry[] {
  const root = isObj(json) && isObj(json.data) ? json.data : json
  const list = Array.isArray(root) ? root
    : isObj(root) ? ([root.items, root.creatives, root.topCreatives, root.videos, root.submissions, root.data].find(Array.isArray) as unknown[] | undefined) || []
      : []
  const out: TopEntry[] = []
  for (const raw of list) {
    if (!isObj(raw)) continue
    const brand = isObj(raw.brand) ? raw.brand : isObj(raw.brandProfile) ? raw.brandProfile : null
    const brandId = str(raw.brandId ?? raw.brand_id ?? brand?.id ?? brand?.brandId) || null
    const brandName = str(raw.brandName ?? raw.brand_name ?? brand?.name ?? brand?.brandName) || null
    const rank = Number(raw.rank ?? raw.position)
    if (!brandId && !brandName) continue
    out.push({ brandId, brandName, rank: Number.isFinite(rank) && rank > 0 ? rank : null })
  }
  return out
}

/** Hits and best rank per brand, by id, and by lower-case name when TRYBE
 *  gives no id. */
export function tallyTop(entries: TopEntry[]): { byId: Map<string, { hits: number; best: number | null }>; byName: Map<string, { hits: number; best: number | null }> } {
  const byId = new Map<string, { hits: number; best: number | null }>()
  const byName = new Map<string, { hits: number; best: number | null }>()
  const add = (m: Map<string, { hits: number; best: number | null }>, k: string, rank: number | null) => {
    const cur = m.get(k) ?? { hits: 0, best: null }
    cur.hits++
    if (rank != null && (cur.best == null || rank < cur.best)) cur.best = rank
    m.set(k, cur)
  }
  for (const e of entries) {
    if (e.brandId) add(byId, e.brandId, e.rank)
    else if (e.brandName) add(byName, e.brandName.toLowerCase(), e.rank)
  }
  return { byId, byName }
}

/** Meta's Ad Library for a brand: active ads in the US with the brand's exact
 *  name in them. */
export function adLibraryUrl(name: string): string {
  const q = encodeURIComponent(`"${name.replace(/"/g, '').trim()}"`)
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&is_targeted_country=false&media_type=all&q=${q}&search_type=keyword_exact_phrase`
}

/** The result count Meta's Ad Library shows ("~1,200 results", "1 result",
 *  "No ads match"), from the page's text. null when it shows neither. */
export function readAdLibraryCount(text: string): number | null {
  const t = String(text || '')
  // "0 results" only as a number of its own: "~1,200 results" ends in 0 too.
  if (/no ads match|(^|[^\d.,])0 results\b/i.test(t)) return 0
  const m = t.match(/~?\s*([\d.,]+)\s*([KkMm])?\s+results?\b/)
  if (!m) return null
  const n = parseFloat(m[1].replace(/,/g, '')) * (/k/i.test(m[2] || '') ? 1_000 : /m/i.test(m[2] || '') ? 1_000_000 : 1)
  return Number.isFinite(n) ? Math.round(n) : null
}

// ── IS THE COUNT THE BRAND'S? (Seb's Star brands test, 2026-10-21) ─────────
// The Ad Library is searched by the brand's name as words, so a brand called
// "Rest", "Dose" or "Loaded" counts every advertiser's ads with that word:
// all three read 50,000, Meta's most. So each count is checked against the
// ads SCOUT saw on the page: how many the brand's own page runs. A count at
// Meta's most, or one that is mostly other advertisers' ads, is said as such
// and never ranked or scored as the brand's ad spend.

/** Meta's Ad Library shows no count above this. */
export const META_ADS_CAP = 50_000
/** Ads seen before a share says anything. */
const OWN_SAMPLE_MIN = 5

const BOILER_LINE = /^(active|inactive|library id|started running|platforms?|this ad has|see ad details|see summary details|ad details|open drop-?down|\d+ ads? use this creative|sponsored)/i

/** Of the ads SCOUT saw on the page, how many the brand's own page runs: the
 *  advertiser line (the last line before "Sponsored" that is not Meta's own
 *  words) spells the brand's name in whole words. Pure. */
export function metaOwnOf(cards: Array<{ text?: unknown }>, name: string): { sample: number; own: number } {
  const key = brandKey(name)
  let sample = 0, own = 0
  for (const c of cards || []) {
    const lines = String(c?.text || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    if (!lines.some((l) => /^library id/i.test(l))) continue
    sample++
    if (key.length < 3) continue
    const sp = lines.findIndex((l) => /^sponsored$/i.test(l))
    const head = (sp > 0 ? lines.slice(0, sp) : lines.slice(0, 4)).filter((l) => !BOILER_LINE.test(l))
    const tokens = head.join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    let mine = false
    for (let i = 0; i < tokens.length && !mine; i++) {
      let acc = ''
      for (let j = i; j < tokens.length; j++) { acc += tokens[j]; if (acc === key) { mine = true; break } if (acc.length >= key.length) break }
    }
    if (mine) own++
  }
  return { sample, own }
}

/** THE BRAND BEFORE'S PAGE (Seb, 2026-10-21: SkyMD read 680 ads while its
 *  Ad Library link shows none). SCOUT reads the brands of a batch one after
 *  another in one tab; a count word for word the same as the brand read just
 *  before it (not none, not Meta's most) may be that brand's page still on
 *  screen, so it is not saved and the brand is counted again later. Pure. */
export function sameAsBefore(prevText: string | null | undefined, text: string | null | undefined, count: number | null): boolean {
  return !!prevText && !!text && prevText.trim() === text.trim() && typeof count === 'number' && count > 0 && count < META_ADS_CAP
}

export type MetaTrust = 'own' | 'unchecked' | 'capped' | 'mixed'
/** Whether a Meta count is the brand's: checked and its own ('own'), not
 *  checked yet ('unchecked', used as before), at Meta's most ('capped'), or
 *  mostly other advertisers' ads ('mixed'). Pure. */
export function metaTrustOf(p: { count: number | null | undefined; own?: number | null; sample?: number | null }): MetaTrust {
  if (typeof p.count !== 'number') return 'unchecked'
  if (p.count >= META_ADS_CAP) return 'capped'
  const sample = p.sample ?? 0
  if (sample >= OWN_SAMPLE_MIN) return (p.own ?? 0) / sample < 0.5 ? 'mixed' : 'own'
  return 'unchecked'
}

/** A count that can be used as the brand's ad spend, or null. Pure. */
export function metaUsable(r: { meta_ads?: unknown; meta_ads_own?: unknown; meta_ads_sample?: unknown }): number | null {
  if (typeof r.meta_ads !== 'number') return null
  const t = metaTrustOf({ count: r.meta_ads, own: typeof r.meta_ads_own === 'number' ? r.meta_ads_own : null, sample: typeof r.meta_ads_sample === 'number' ? r.meta_ads_sample : null })
  return t === 'own' || t === 'unchecked' ? r.meta_ads : null
}

/** A count that is not the brand's, in words. Pure. */
export function metaTrustWords(t: MetaTrust, p: { name: string; count: number; own?: number | null; sample?: number | null }): { short: string; long: string } | null {
  if (t === 'capped') return { short: 'Too many to count', long: `Meta shows ${META_ADS_CAP.toLocaleString('en-US')} or more ads with the words \u201c${p.name}\u201d, its most: the name is a common word, so the count is every advertiser\u2019s, not the brand\u2019s.` }
  if (t === 'mixed') return { short: 'Mostly other advertisers', long: `Of the ${p.sample} ads SCOUT saw for \u201c${p.name}\u201d, ${p.own} ${p.own === 1 ? 'was' : 'were'} the brand\u2019s own: the name is a common word, so the ${p.count.toLocaleString('en-US')} counted are mostly other advertisers\u2019 ads.` }
  return null
}

// ── THE VERDICT (Huntr's strong pick / worth a look / skip; Seb 2026-10-14) ──

export type Verdict = 'strong' | 'look' | 'skip' | 'unknown'
export const VERDICT_WORDS: Record<Verdict, string> = { strong: 'Strong pick', look: 'Worth a look', skip: 'Skip', unknown: 'Too little read' }

/** One word for the Best bet score, weighed by your priorities. With fewer
 *  than two signals read it says so instead of judging: a brand MVP knows
 *  little about is not a "skip". Pure. */
export function verdictOf(score: number, read: number): Verdict {
  if (read < 2) return 'unknown'
  if (score >= 40) return 'strong'
  if (score >= 12) return 'look'
  return 'skip'
}
