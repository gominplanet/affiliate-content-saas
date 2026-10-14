// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// YOUR ADS, LIVE (Seb, 2026-10-14, after Rob's Oink Suite video: "build all
// 4"). Brands on TRYBE run creators' videos as ads, and TRYBE shows each
// creator how theirs do: earned, live ads, impressions, link clicks, hook
// rate, average watch time and click rate, for the last 7, 14 or 30 days.
// SCOUT 1.47.0 reads them from the creator's own signed-in TRYBE
// (GET /backend/api/creator/v2/analytics and /analytics/submissions, read
// only), and this reads the answer.
//
// TRYBE's names come from its own page code where they were seen (a video's
// metrics.thumbstopRate is the hook rate, metrics.linkCtr, metrics.avgWatched
// in seconds, metrics.avgWatchPercent, metrics.linkClicks; a row's hookRate,
// ctr and earnings). The totals were not seen, so each one is found by the
// names it is likely to have, and when TRYBE sends no total it is added up
// from the videos. A number TRYBE did not send is null, "not sent", never 0.
//
// Then the winners: the brands where your videos earn in the window and hook
// people, so the double down stage means videos that work as ads, not only
// approvals. Pure, so it is tested (scripts/test-trybe-ads).

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v.replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : null }
  return null
}

export const AD_PERIODS = ['7d', '14d', '30d'] as const
export type AdPeriod = typeof AD_PERIODS[number]
export const PERIOD_DAYS: Record<AdPeriod, number> = { '7d': 7, '14d': 14, '30d': 30 }

export interface AdTotals {
  earned: number | null
  liveAds: number | null
  impressions: number | null
  clicks: number | null
  /** Link click rate, in percent. */
  ctr: number | null
  /** Hook rate (TRYBE's thumbstop rate), in percent. */
  hookRate: number | null
  /** Average watch time, in seconds, and as a percent of the video. */
  avgWatchSec: number | null
  avgWatchPct: number | null
  /** What brands spent running your videos as ads. */
  spend: number | null
}
export const NO_TOTALS: AdTotals = { earned: null, liveAds: null, impressions: null, clicks: null, ctr: null, hookRate: null, avgWatchSec: null, avgWatchPct: null, spend: null }

const KEYS: Record<keyof AdTotals, string[]> = {
  earned: ['earnings', 'totalEarnings', 'earned', 'totalEarned', 'periodEarnings', 'revenue', 'payout', 'totalPayout'],
  liveAds: ['activeAds', 'liveAds', 'activeAdsCount', 'liveAdsCount', 'adsLive', 'runningAds', 'activeAdCount'],
  impressions: ['impressions', 'totalImpressions', 'views', 'totalViews'],
  clicks: ['linkClicks', 'clicks', 'totalClicks', 'totalLinkClicks'],
  ctr: ['linkCtr', 'ctr', 'clickThroughRate', 'avgCtr'],
  hookRate: ['thumbstopRate', 'hookRate', 'thumbStopRate', 'avgHookRate', 'avgThumbstopRate'],
  avgWatchSec: ['avgWatched', 'avgWatchTime', 'averageWatchTime', 'avgWatchSeconds'],
  avgWatchPct: ['avgWatchPercent', 'avgWatchPct', 'averageWatchPercent'],
  spend: ['spend', 'adSpend', 'totalSpend', 'totalAdSpend', 'amountSpent'],
}

/** The value under the first of these keys, on the object or inside its
 *  metrics, totals, summary or overview. Pure. */
function find(o: Obj, keys: string[]): unknown {
  const places = [o, ...['metrics', 'totals', 'summary', 'overview', 'stats', 'kpis'].map((k) => o[k]).filter(isObj)] as Obj[]
  for (const key of keys) for (const p of places) {
    const k = Object.keys(p).find((n) => n.toLowerCase() === key.toLowerCase())
    if (k && p[k] != null && p[k] !== '') {
      const v = p[k]
      // { value: 12.3 } or { current: 12.3 }, as dashboards often send.
      return isObj(v) ? (v.value ?? v.current ?? v.total ?? v.amount) : v
    }
  }
  return undefined
}

/** The answer's own object: TRYBE answers {success, data}. */
const rootOf = (json: unknown): unknown => (isObj(json) && (isObj(json.data) || Array.isArray(json.data)) ? json.data : json)

function totalsOf(o: Obj): AdTotals {
  const out = { ...NO_TOTALS }
  for (const k of Object.keys(KEYS) as Array<keyof AdTotals>) out[k] = num(find(o, KEYS[k]))
  // Earnings in cents when the key says so.
  const cents = Object.keys(o).find((k) => /earnings.*cents|cents.*earn/i.test(k))
  if (out.earned == null && cents && num(o[cents]) != null) out.earned = (num(o[cents]) as number) / 100
  return out
}

/** GET /backend/api/creator/v2/analytics?period=: the creator's totals. */
export function readAdTotals(json: unknown): AdTotals {
  const root = rootOf(json)
  return isObj(root) ? totalsOf(root) : { ...NO_TOTALS }
}

export interface AdVideo extends AdTotals {
  id: string
  title: string | null
  brand: string | null
  brandId: string | null
  thumbnail: string | null
  /** Running as an ad now, when TRYBE says. */
  live: boolean | null
}

/** GET /backend/api/creator/v2/analytics/submissions?period=: one entry per
 *  video, with its results. Pure. */
export function readAdVideos(json: unknown): AdVideo[] {
  const root = rootOf(json)
  const list = Array.isArray(root) ? root
    : isObj(root) ? ([root.items, root.submissions, root.videos, root.data, root.results, root.rows].find(Array.isArray) as unknown[] | undefined) || [] : []
  const out: AdVideo[] = []
  for (const raw of list) {
    if (!isObj(raw)) continue
    const sub = isObj(raw.submission) ? raw.submission : null
    const brand = isObj(raw.brand) ? raw.brand : isObj(sub?.brand) ? sub!.brand as Obj : null
    const meta = isObj(raw.metadata) ? raw.metadata : isObj(sub?.metadata) ? sub!.metadata as Obj : null
    const id = str(raw.id ?? raw.submissionId ?? sub?.id)
    if (!id) continue
    const liveRaw = raw.isActive ?? raw.active ?? raw.isLive ?? raw.live ?? raw.hasActiveAds ?? raw.activeAd
    const liveCount = num(raw.activeAds ?? raw.liveAds)
    out.push({
      ...totalsOf(raw),
      id,
      title: str(raw.title ?? raw.caption ?? sub?.title ?? meta?.title ?? raw.productName ?? (isObj(raw.product) ? raw.product.title ?? raw.product.name : '')) || null,
      brand: str(raw.brandName ?? brand?.name ?? sub?.brandName) || null,
      brandId: str(raw.brandId ?? brand?.id ?? sub?.brandId) || null,
      thumbnail: str(raw.thumbnailUrl ?? meta?.thumbnailUrl ?? sub?.thumbnailUrl) || null,
      live: typeof liveRaw === 'boolean' ? liveRaw : liveCount != null ? liveCount > 0 : null,
    })
  }
  return out
}

/** Totals from the videos, for whatever TRYBE's totals left out: sums for
 *  counts and money, rates weighted by impressions (a plain average when no
 *  video has impressions). A total TRYBE sent always wins. Pure. */
export function fillTotals(t: AdTotals, videos: AdVideo[]): AdTotals {
  if (!videos.length) return t
  const sum = (k: keyof AdTotals) => { const v = videos.map((x) => x[k]).filter((n): n is number => n != null); return v.length ? v.reduce((a, b) => a + b, 0) : null }
  const rate = (k: keyof AdTotals) => {
    const w = videos.filter((x) => x[k] != null)
    if (!w.length) return null
    const weighed = w.filter((x) => (x.impressions ?? 0) > 0)
    if (weighed.length === w.length) { const tot = weighed.reduce((a, x) => a + (x.impressions as number), 0); return weighed.reduce((a, x) => a + (x[k] as number) * (x.impressions as number), 0) / tot }
    return w.reduce((a, x) => a + (x[k] as number), 0) / w.length
  }
  const liveKnown = videos.filter((v) => v.live != null)
  return {
    earned: t.earned ?? sum('earned'),
    liveAds: t.liveAds ?? (liveKnown.length ? liveKnown.filter((v) => v.live).length : null),
    impressions: t.impressions ?? sum('impressions'),
    clicks: t.clicks ?? sum('clicks'),
    ctr: t.ctr ?? rate('ctr'),
    hookRate: t.hookRate ?? rate('hookRate'),
    avgWatchSec: t.avgWatchSec ?? rate('avgWatchSec'),
    avgWatchPct: t.avgWatchPct ?? rate('avgWatchPct'),
    spend: t.spend ?? sum('spend'),
  }
}

/** How many of the numbers were read: 0 means TRYBE's answer had none MVP
 *  knows, which is said, never shown as a row of zeros. Pure. */
export const readCount = (t: AdTotals) => Object.values(t).filter((v) => v != null).length

/** Earned a day in the last 7 days against the last 30: up, down or steady.
 *  Null when either is not known or the month earned nothing. Pure. */
export function paceOf(earned7: number | null, earned30: number | null): { dir: 'up' | 'down' | 'steady'; pct: number } | null {
  if (earned7 == null || earned30 == null || earned30 <= 0) return null
  const a = earned7 / 7, b = earned30 / 30
  const pct = Math.round(((a - b) / b) * 100)
  return { dir: pct >= 15 ? 'up' : pct <= -15 ? 'down' : 'steady', pct }
}

export interface AdBrand { brand: string; brandId: string | null; videos: number; live: number; earned: number; hookRate: number | null; ctr: number | null }

/** Your results per brand, most earned first. Pure. */
export function adBrands(videos: AdVideo[]): AdBrand[] {
  const by = new Map<string, AdVideo[]>()
  for (const v of videos) {
    const k = (v.brandId || v.brand || '').toLowerCase()
    if (!k) continue
    by.set(k, [...(by.get(k) || []), v])
  }
  const out: AdBrand[] = []
  for (const list of by.values()) {
    const f = fillTotals({ ...NO_TOTALS }, list)
    out.push({ brand: list.find((v) => v.brand)?.brand || 'A brand', brandId: list.find((v) => v.brandId)?.brandId ?? null, videos: list.length, live: list.filter((v) => v.live).length, earned: f.earned ?? 0, hookRate: f.hookRate, ctr: f.ctr })
  }
  return out.sort((a, b) => b.earned - a.earned || (b.hookRate ?? -1) - (a.hookRate ?? -1))
}

/** Your best videos as ads: most earned, then the best hook rate. Pure. */
export function bestVideos(videos: AdVideo[], n = 5): AdVideo[] {
  return [...videos].filter((v) => (v.earned ?? 0) > 0 || v.hookRate != null)
    .sort((a, b) => (b.earned ?? 0) - (a.earned ?? 0) || (b.hookRate ?? -1) - (a.hookRate ?? -1)).slice(0, n)
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null }

export interface AdWinner { brand: string; brandId: string | null; why: string }

/** The brands winning on ads: your videos for them earned in the window,
 *  and hook at least as well as your typical video (when hook rates are
 *  known). At most five, most earned first. Pure. */
export function adWinners(brands: AdBrand[], days: number): AdWinner[] {
  const mid = median(brands.map((b) => b.hookRate).filter((n): n is number => n != null))
  const money = (n: number) => `$${n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2).replace(/\.00$/, '')}`
  return brands
    .filter((b) => b.earned > 0 && (mid == null || b.hookRate == null || b.hookRate >= mid))
    .slice(0, 5)
    .map((b) => ({
      brand: b.brand, brandId: b.brandId,
      why: `${money(b.earned)} from your ads in ${days} days${b.hookRate != null ? `, hook rate ${b.hookRate.toFixed(1)}%` : ''}${b.live ? `, ${b.live} live now` : ''}`,
    }))
}

// ── DIDN'T RUN? MOVE ON (Keighly Hart's $15K month, Seb 2026-10-14). Her
// member never got attached to a video a brand did not run: she moved to the
// next brand or the next angle. Videos TRYBE lists with no ad results at all
// in the window, by brand. Only videos TRYBE sent impressions for count, so
// "no numbers" is never read as "did not run". Pure.

export interface NotRun { brand: string; brandId: string | null; videos: number; says: string }

export function notRunning(videos: AdVideo[], days: number): NotRun[] {
  const by = new Map<string, AdVideo[]>()
  for (const v of videos) {
    if (v.impressions !== 0 || v.live === true || (v.earned ?? 0) > 0) continue
    const k = (v.brandId || v.brand || '').toLowerCase()
    if (!k) continue
    by.set(k, [...(by.get(k) || []), v])
  }
  const ranWith = new Set(videos.filter((v) => (v.impressions ?? 0) > 0).map((v) => (v.brandId || v.brand || '').toLowerCase()))
  return Array.from(by.values()).map((list) => {
    const brand = list[0].brand || 'A brand'
    const k = (list[0].brandId || list[0].brand || '').toLowerCase()
    const n = list.length
    return {
      brand, brandId: list[0].brandId, videos: n,
      says: ranWith.has(k)
        ? `${n} of your videos for ${brand} got no ad results in ${days} days while others did: try a new hook or angle from its brief for the next ones.`
        : `None of your ${n} video${n === 1 ? '' : 's'} for ${brand} ran as an ad in ${days} days. Do not wait on it: move your next videos to a brand that runs ads.`,
    }
  }).sort((a, b) => b.videos - a.videos)
}

// ── HOOK RATE AGAINST CLICK RATE (Colin Reich, Seb 2026-10-14: "build 1, 2,
// 3, and 4"). Read together they say what to fix: "55% hook rate and a 0.1%
// click through rate" is a hook that stops the wrong people; a low hook rate
// with a good click rate is a good body behind a weak hook. Then remix: the
// hook of your best stopper with the body of your best clicker. Pure.

export type Diagnosis = 'winner' | 'wrong_people' | 'weak_hook' | 'weak' | 'early'
export const DIAGNOSIS_WORDS: Record<Diagnosis, { label: string; fix: string }> = {
  winner: { label: 'Winner', fix: 'Make more like it: same hook style, new angles.' },
  wrong_people: { label: 'Hook stops the wrong people', fix: 'People stop but do not click: make the hook about the problem the product solves, not shock value.' },
  weak_hook: { label: 'Good body, weak hook', fix: 'People who stay click: keep this body and try a stronger first 3 seconds.' },
  weak: { label: 'Neither works yet', fix: 'Try a different angle from the brief.' },
  early: { label: 'Too early to judge', fix: 'Fewer than 1,000 impressions: give it time.' },
}
/** Below this many impressions a video is not judged. */
export const MIN_IMPRESSIONS = 1000

/** One video's hook rate (percent) against its click rate (percent). Pure. */
export function diagnose(v: Pick<AdTotals, 'hookRate' | 'ctr' | 'impressions'>): Diagnosis | null {
  if (v.hookRate == null || v.ctr == null) return null
  if (v.impressions != null && v.impressions < MIN_IMPRESSIONS) return 'early'
  const hookHigh = v.hookRate >= 25, clickHigh = v.ctr >= 1
  if (hookHigh && clickHigh) return 'winner'
  if (v.hookRate >= 40 && v.ctr < 0.5) return 'wrong_people'
  if (!hookHigh && clickHigh) return 'weak_hook'
  if (hookHigh) return v.ctr < 0.5 ? 'wrong_people' : 'winner'
  return 'weak'
}

export interface Remix { hookFrom: AdVideo; bodyFrom: AdVideo; says: string }

/** The remix: the opening of your video that stops people best (among ones
 *  with a fair click rate) with the body of the one that clicks best, when
 *  they are two different videos. Pure. */
export function remixOf(videos: AdVideo[]): Remix | null {
  const judged = videos.filter((v) => v.hookRate != null && v.ctr != null && (v.impressions == null || v.impressions >= MIN_IMPRESSIONS))
  if (judged.length < 2) return null
  const hook = [...judged].filter((v) => (v.ctr as number) >= 0.3).sort((a, b) => (b.hookRate as number) - (a.hookRate as number))[0]
  const body = [...judged].sort((a, b) => (b.ctr as number) - (a.ctr as number))[0]
  if (!hook || !body || hook.id === body.id) return null
  const name = (v: AdVideo) => `"${(v.title || 'a video').slice(0, 60)}"`
  return { hookFrom: hook, bodyFrom: body, says: `Remix: open with the first 3 seconds of ${name(hook)} (hook rate ${(hook.hookRate as number).toFixed(1)}%), then the body of ${name(body)} (click rate ${(body.ctr as number).toFixed(2)}%).` }
}
