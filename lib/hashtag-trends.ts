// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// LIVE HASHTAG DATA, READ FROM THE PLATFORMS THEMSELVES (Seb, 2026-10-16:
// "lifting them from like TikTok Creative Center's trending hashtags, that's
// a great idea. We could do the same thing with YouTube. We could do the same
// thing with Instagram as well").
//
//   TikTok: Creative Center's trending hashtags, read by MVP's server every
//     night (cron/hashtag-trends) from the list TikTok's own page asks for,
//     industry by industry: signed out, TikTok gives the top 3 of each, so 21
//     industries and two periods make a list about products, not just the
//     day's memes. (Seb, 2026-10-16: SCOUT's read hit Chrome's error page;
//     Creative Center had moved to /creative/creativeCenter/trends.)
//   YouTube: each tag's own hashtag page ("2M videos • 505K channels"), read
//     by MVP's server (cron/hashtag-trends), and YouTube's search suggestions.
//   Instagram: each tag's post count, asked of Instagram by SCOUT from the
//     creator's own signed-in Chrome (Instagram Login has no hashtag search).
//
// Kept in hashtag_trends (migration 434), shared: one member's read helps
// every member's next caption. The engine (lib/hashtag-engine) uses a trend
// only when it is about the content, so a viral #halloween never lands on an
// air fryer. Parsers here are pure; nothing is guessed when a read fails.

import { hashify } from '@/lib/hashtag-map'
import { tagProblem } from '@/lib/hashtag-engine'

export interface TrendRow { platform: 'tiktok' | 'youtube' | 'instagram'; tag: string; source: string; region?: string; rank?: number | null; posts?: number | null; views?: number | null; label?: string | null }

/** "2M" -> 2000000, "505K" -> 505000, "1.2B" -> 1200000000, "12,345" -> 12345. */
export function compactNumber(raw: unknown): number | null {
  const m = String(raw ?? '').trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/i)
  if (!m) return null
  const unit = m[2] ? ({ K: 1e3, M: 1e6, B: 1e9 } as Record<string, number>)[m[2].toUpperCase()] : 1
  const n = Math.round(parseFloat(m[1]) * unit)
  return Number.isFinite(n) ? n : null
}

/** A clean, usable tag for the trend table, or null. */
export function trendTag(raw: unknown): string | null {
  const { tag, problem } = tagProblem(String(raw ?? ''))
  return tag && !problem ? tag : null
}

/** TikTok Creative Center's hashtag list, from whatever its page loaded.
 *  SCOUT hands over each answer it saw as { url, body } (the address says the
 *  country), and the rows it read off the page as { rows } when the answers
 *  were not there. A tag TikTok marks as promoted is an ad, not a trend, and
 *  is left out. */
export function parseTikTokCC(bodies: unknown[], country = 'US'): TrendRow[] {
  const out = new Map<string, TrendRow>()
  const add = (name: unknown, rank: unknown, posts: unknown, views: unknown, industry: unknown, region: string) => {
    const tag = trendTag(name)
    if (!tag || out.has(tag)) return
    const r = Number(rank)
    out.set(tag, {
      platform: 'tiktok', tag, source: 'tiktok_cc', region,
      rank: Number.isFinite(r) && r > 0 ? Math.round(r) : null,
      posts: typeof posts === 'number' ? posts : compactNumber(posts),
      views: typeof views === 'number' ? views : compactNumber(views),
      label: typeof industry === 'string' && industry ? `trending on TikTok in ${industry}` : null,
    })
  }
  const fallback = /^[A-Z]{2}$/.test(country) ? country : 'US'
  for (const raw of Array.isArray(bodies) ? bodies : []) {
    let b: unknown = raw
    let region = fallback
    const wrap = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null
    if (wrap && 'body' in wrap) {
      b = wrap.body
      const cc = String(wrap.url || '').match(/[?&]country_code=([A-Za-z]{2})\b/)
      if (cc) region = cc[1].toUpperCase()
    }
    const o = b && typeof b === 'object' ? b as Record<string, any> : {} // eslint-disable-line @typescript-eslint/no-explicit-any
    const list = Array.isArray(o?.data?.list) ? o.data.list : Array.isArray(o?.items) ? o.items : Array.isArray(o?.list) ? o.list : Array.isArray(o?.rows) ? o.rows : Array.isArray(b) ? b : []
    for (const it of list as Array<Record<string, any>>) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!it || typeof it !== 'object' || it.is_promoted === true || it.isPromoted === true) continue
      const itRegion = typeof it.country_info?.id === 'string' && /^[A-Z]{2}$/i.test(it.country_info.id) ? it.country_info.id.toUpperCase() : region
      add(it.hashtag_name ?? it.hashtagName ?? it.name ?? it.tag, it.rank ?? it.rankIndex ?? it.position, it.publish_cnt ?? it.publishCnt ?? it.posts, it.video_views ?? it.videoViews ?? it.vv ?? it.views, it.industry_info?.value ?? it.industry ?? null, itRegion)
    }
  }
  return Array.from(out.values()).slice(0, 500)
}

/** Creative Center's industries, as TikTok labels them. */
export const TIKTOK_INDUSTRIES: Record<string, string> = {
  '10000000000': 'Education', '11000000000': 'Vehicle & Transportation', '12000000000': 'Baby, Kids & Maternity',
  '13000000000': 'Financial Services', '14000000000': 'Beauty & Personal Care', '15000000000': 'Tech & Electronics',
  '16000000000': 'Appliances', '17000000000': 'Travel', '18000000000': 'Household Products', '19000000000': 'Pets',
  '20000000000': 'Apps', '21000000000': 'Home Improvement', '22000000000': 'Apparel & Accessories',
  '23000000000': 'News & Entertainment', '24000000000': 'Business Services', '25000000000': 'Games',
  '26000000000': 'Life Services', '27000000000': 'Food & Beverage', '28000000000': 'Sports & Outdoor',
  '29000000000': 'Health', '30000000000': 'E-Commerce',
}
export const TIKTOK_LIST_URL = 'https://ads.tiktok.com/CreativeOne/KnowledgeAPI/GetHashtagList'

/** One Creative Center list, as TikTok answered it: { items: [{ hashtagName,
 *  rankIndex, publishCnt, vv, industryIDs }] }. The rank is within this list
 *  (this industry, this period), and the label says so. */
export function parseTikTokList(json: unknown, ctx: { country: string; period: number; industry: string | null }): TrendRow[] {
  const o = json && typeof json === 'object' ? json as { items?: unknown } : {}
  const when = ctx.period <= 7 ? 'this week' : ctx.period <= 30 ? 'this month' : `over ${ctx.period} days`
  const where = ctx.industry && TIKTOK_INDUSTRIES[ctx.industry] ? ` in ${TIKTOK_INDUSTRIES[ctx.industry]}` : ''
  const out: TrendRow[] = []
  for (const it of Array.isArray(o.items) ? o.items as Array<Record<string, unknown>> : []) {
    const tag = trendTag(it?.hashtagName)
    if (!tag || it?.isPromoted === true) continue
    const rank = Number(it.rankIndex)
    out.push({
      platform: 'tiktok', tag, source: 'tiktok_cc', region: ctx.country,
      rank: Number.isFinite(rank) && rank > 0 ? Math.round(rank) : null,
      posts: compactNumber(it.publishCnt), views: compactNumber(it.vv),
      label: `${Number.isFinite(rank) && rank > 0 ? `#${Math.round(rank)} ` : ''}trending on TikTok${where} ${when}`,
    })
  }
  return out
}

/** Every Creative Center list MVP reads: the overall list and each industry,
 *  this week and this month. Each tag is kept once, at its best showing
 *  (an industry list over the overall one, this week over this month).
 *  `answered` counts the lists TikTok actually answered, so a night TikTok
 *  refused reads as refused, never as a quiet night. */
export async function readTikTokTrends(country = 'US', opts: { atOnce?: number; fetcher?: typeof fetch } = {}): Promise<{ rows: TrendRow[]; asked: number; answered: number; error: string | null }> {
  const go = opts.fetcher || fetch
  const cc = /^[A-Z]{2}$/.test(country) ? country : 'US'
  const asks: Array<{ period: number; industry: string | null }> = []
  for (const period of [7, 30]) for (const industry of [null, ...Object.keys(TIKTOK_INDUSTRIES)]) asks.push({ period, industry })
  const best = new Map<string, { row: TrendRow; score: number }>()
  let answered = 0
  let error: string | null = null
  const atOnce = Math.max(1, opts.atOnce ?? 4)
  for (let i = 0; i < asks.length; i += atOnce) {
    await Promise.all(asks.slice(i, i + atOnce).map(async (a) => {
      try {
        const body: Record<string, unknown> = { timeRange: a.period, countryCode: cc, page: 1, limit: 20 }
        if (a.industry) body.industryID = Number(a.industry)
        const r = await go(TIKTOK_LIST_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://ads.tiktok.com', Referer: 'https://ads.tiktok.com/creative/creativeCenter/trends/hashtag' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) })
        const j = await r.json().catch(() => null) as { items?: unknown; code?: string; message?: string } | null
        if (!r.ok || !j || !Array.isArray(j.items)) { error = error || `TikTok answered ${r.status}${j?.message ? `: ${String(j.message).slice(0, 120)}` : ''}`; return }
        answered++
        for (const row of parseTikTokList(j, { country: cc, ...a })) {
          const score = (a.industry ? 0 : 10) + (a.period === 7 ? 0 : 5) + (row.rank ?? 9)
          const had = best.get(row.tag)
          if (!had || score < had.score) best.set(row.tag, { row, score })
        }
      } catch (e) { error = error || (e instanceof Error ? e.message : 'TikTok did not answer') }
    }))
  }
  return { rows: Array.from(best.values()).map((b) => b.row), asked: asks.length, answered, error: answered ? null : error || 'TikTok answered none of the lists' }
}

/** A YouTube hashtag page's counts: "2M videos • 505K channels". */
export function parseYouTubeHashtagPage(html: string): { videos: number | null; channels: number | null } {
  const m = String(html || '').match(/"content":"([\d.,]+\s*[KMB]?)\s+videos?\s*[•·]\s*([\d.,]+\s*[KMB]?)\s+channels?"/i)
    || String(html || '').match(/([\d.,]+\s*[KMB]?)\s+videos?\s*[•·]\s*([\d.,]+\s*[KMB]?)\s+channels?/i)
  return m ? { videos: compactNumber(m[1].replace(/\s/g, '')), channels: compactNumber(m[2].replace(/\s/g, '')) } : { videos: null, channels: null }
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

/** One tag's activity on YouTube, from its public hashtag page. Null when
 *  YouTube did not answer or showed no counts (never taken as zero). */
export async function readYouTubeHashtag(tag: string): Promise<TrendRow | null> {
  const clean = trendTag(tag)
  if (!clean) return null
  try {
    const r = await fetch(`https://www.youtube.com/hashtag/${encodeURIComponent(clean.slice(1))}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(15_000) })
    if (!r.ok) return null
    const { videos, channels } = parseYouTubeHashtagPage(await r.text())
    if (videos == null) return null
    return { platform: 'youtube', tag: clean, source: 'youtube', posts: videos, views: channels, label: `on YouTube: ${short(videos)} videos from ${channels != null ? short(channels) : 'many'} channels` }
  } catch { return null }
}

/** What people type into YouTube's search box after these words: real
 *  search demand, for the YouTube tags field. Empty on any failure. */
export async function youtubeSuggestions(seed: string, limit = 8): Promise<string[]> {
  const q = String(seed || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (q.length < 3) return []
  try {
    const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6_000) })
    if (!r.ok) return []
    const j = await r.json() as [string, string[]]
    return (Array.isArray(j?.[1]) ? j[1] : []).map((s) => String(s).trim()).filter((s) => s.length >= 3 && s.length <= 60 && !/(?:19|20)\d\d/.test(s)).slice(0, limit)
  } catch { return [] }
}

/** Instagram's own post count for tags, as SCOUT read them. */
export function parseInstagramCounts(items: unknown[]): TrendRow[] {
  const out: TrendRow[] = []
  for (const it of Array.isArray(items) ? items.slice(0, 50) : []) {
    const o = it && typeof it === 'object' ? it as Record<string, unknown> : {}
    const tag = trendTag(o.tag)
    const posts = typeof o.posts === 'number' && Number.isFinite(o.posts) && o.posts >= 0 ? Math.round(o.posts) : null
    if (tag && posts != null) out.push({ platform: 'instagram', tag, source: 'instagram', posts, label: `on Instagram: ${short(posts)} posts` })
  }
  return out
}

function short(n: number): string {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n)
}

/** Kept when it carries a reading. A tag with almost no posts is kept too:
 *  knowing a tag is a dead end is what stops the engine using it, and stops
 *  SCOUT asking about it again tomorrow (lib/hashtag-engine trendStanding). */
export function worthKeeping(row: TrendRow): boolean {
  return row.source === 'tiktok_cc' || (typeof row.posts === 'number' && Number.isFinite(row.posts) && row.posts >= 0)
}

/** Save rows (shared table). Returns how many were kept; 0 before migration 434. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveTrends(admin: any, rows: TrendRow[]): Promise<{ saved: number; error: string | null }> {
  const now = new Date().toISOString()
  const list = rows.filter(worthKeeping).map((r) => ({ platform: r.platform, tag: hashify(r.tag), source: r.source, region: r.region || 'US', rank: r.rank ?? null, posts: r.posts ?? null, views: r.views ?? null, label: r.label ?? null, seen_at: now }))
  if (!list.length) return { saved: 0, error: null }
  const { error } = await admin.from('hashtag_trends').upsert(list, { onConflict: 'platform,tag,source,region' })
  return error ? { saved: 0, error: error.message } : { saved: list.length, error: null }
}
