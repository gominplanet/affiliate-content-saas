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
  /** A flat fee per video, in dollars, when its pay says one. */
  perVideo?: number | null
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
export type Factor = 'competition' | 'adSpend' | 'perVideo' | 'percent' | 'paysCreators' | 'samples' | 'newBrand' | 'amazon' | 'program'
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
]
/** 0: does not matter, 1: normal, 2: matters a lot. */
export type Weight = 0 | 1 | 2
export type Priorities = Record<Factor, Weight>
export const DEFAULT_PRIORITIES: Priorities = { competition: 1, adSpend: 1, perVideo: 1, percent: 1, paysCreators: 1, samples: 1, newBrand: 1, amazon: 1, program: 1 }

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
    if (fee >= 50) { add('perVideo', 15); reasons.push({ text: `$${fee} per video`, tone: 'good' }) }
    else if (fee >= 20) { add('perVideo', 8); reasons.push({ text: `$${fee} per video`, tone: 'good' }) }
    else { add('perVideo', 3); reasons.push({ text: `$${fee} per video`, tone: 'info' }) }
  }
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
