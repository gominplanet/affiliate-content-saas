// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/amazon-videos/insights — what the creator's Amazon video library says
// about their business.
//
// The earnings tables answer "how much". This answers the questions that decide
// what to shoot next, from data Amazon already recorded and never shows back:
//
//   Which length holds attention?      average percent viewed, by duration
//   Which uploads are dead weight?     videos with no views, or no products
//   Does publishing more actually pay? videos per month against earnings
//   What is my best work?              ranked by views and by hearts
//
// The null rule from the earnings page carries over unchanged. Amazon not
// reporting a metric and a video genuinely scoring zero are different claims,
// and averages are taken only over videos that actually reported.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface VideoRow {
  aci: string
  description: string | null
  state: string | null
  views: number | null
  hearts: number | null
  avg_pct_viewed: number | null
  avg_view_sec: number | null
  duration_sec: number | null
  product_count: number | null
  published_at: string | null
}

/** Length bands a creator actually thinks in, rather than even splits. */
const BANDS: { label: string; min: number; max: number }[] = [
  { label: 'Under 20s', min: 0, max: 20 },
  { label: '20 to 45s', min: 20, max: 45 },
  { label: '45 to 90s', min: 45, max: 90 },
  { label: '90s to 3 min', min: 90, max: 180 },
  { label: 'Over 3 min', min: 180, max: Number.POSITIVE_INFINITY },
]

/** Mean over the values that exist. Returns null when none did, so "Amazon did
 *  not report this" never renders as a zero average. */
function mean(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}
function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // Read every video, not the first page of them. PostgREST caps a select at
  // 1,000 rows, and a library of thousands silently truncated at that would make
  // every average and every count on this page wrong in the same quiet way the
  // scanner kept failing.
  const rows: VideoRow[] = []
  for (let from = 0; from < 20000; from += 1000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('amazon_videos')
      .select('aci,description,state,views,hearts,avg_pct_viewed,avg_view_sec,duration_sec,product_count,published_at')
      .eq('user_id', user.id)
      .order('aci', { ascending: true })
      .range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message, videos: 0 }, { status: 200 })
    const page = (data ?? []) as VideoRow[]
    rows.push(...page)
    if (page.length < 1000) break
  }

  if (!rows.length) {
    return NextResponse.json({ ok: true, videos: 0 })
  }

  const withViews = rows.filter(r => r.views != null) as (VideoRow & { views: number })[]
  const withRetention = rows.filter(r => r.avg_pct_viewed != null)

  // ── retention by length ───────────────────────────────────────────────────
  // The most directly actionable thing here: how long a video should be.
  const byLength = BANDS.map(b => {
    const inBand = rows.filter(r => r.duration_sec != null && r.duration_sec >= b.min && r.duration_sec < b.max)
    const ret = inBand.map(r => r.avg_pct_viewed).filter((v): v is number => v != null)
    const vw = inBand.map(r => r.views).filter((v): v is number => v != null)
    return {
      label: b.label,
      videos: inBand.length,
      avgPctViewed: mean(ret),
      medianViews: median(vw),
      totalViews: vw.length ? vw.reduce((a, c) => a + c, 0) : null,
    }
  }).filter(b => b.videos > 0)

  // ── dead weight ───────────────────────────────────────────────────────────
  // Uploads that earned nothing back. Counting them is the point: on a library
  // of thousands this is usually a number the creator has never seen.
  const noViews = withViews.filter(r => r.views === 0).length
  const noProducts = rows.filter(r => r.product_count === 0).length
  const notLive = rows.filter(r => r.state && !/live|publish/i.test(r.state)).length

  // ── output over time ──────────────────────────────────────────────────────
  // Videos published per month, so it can be set against earnings per month and
  // answer whether publishing more actually paid.
  const perMonth: Record<string, { videos: number; views: number | null }> = {}
  for (const r of rows) {
    if (!r.published_at) continue
    const m = r.published_at.slice(0, 7)
    if (!perMonth[m]) perMonth[m] = { videos: 0, views: null }
    perMonth[m].videos++
    if (r.views != null) perMonth[m].views = (perMonth[m].views ?? 0) + r.views
  }

  // Earnings for the same months, so the comparison is on one chart rather than
  // in the creator's head across two pages.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: earn } = await (supabase as any)
    .from('amazon_earnings_periods')
    .select('period_start,earnings_cents')
    .eq('user_id', user.id)
  const earnByMonth: Record<string, number> = {}
  for (const e of (earn ?? []) as { period_start: string; earnings_cents: number | null }[]) {
    if (e.earnings_cents == null) continue
    const m = e.period_start.slice(0, 7)
    earnByMonth[m] = (earnByMonth[m] ?? 0) + e.earnings_cents
  }

  const months = Array.from(new Set([...Object.keys(perMonth), ...Object.keys(earnByMonth)]))
    .sort()
    .slice(-18)
    .map(m => ({
      month: m,
      videos: perMonth[m]?.videos ?? 0,
      views: perMonth[m]?.views ?? null,
      earningsCents: earnByMonth[m] ?? null,
    }))

  const top = (pick: (r: VideoRow) => number | null, n = 8) =>
    rows
      .filter(r => pick(r) != null)
      .sort((a, b) => (pick(b) as number) - (pick(a) as number))
      .slice(0, n)
      .map(r => ({
        aci: r.aci,
        description: r.description,
        views: r.views,
        hearts: r.hearts,
        avgPctViewed: r.avg_pct_viewed,
        durationSec: r.duration_sec,
        productCount: r.product_count,
        publishedAt: r.published_at,
      }))

  const allViews = withViews.map(r => r.views)
  return NextResponse.json({
    ok: true,
    videos: rows.length,
    totals: {
      views: allViews.length ? allViews.reduce((a, c) => a + c, 0) : null,
      hearts: (() => {
        const h = rows.map(r => r.hearts).filter((v): v is number => v != null)
        return h.length ? h.reduce((a, c) => a + c, 0) : null
      })(),
      medianViews: median(allViews),
      avgPctViewed: mean(withRetention.map(r => r.avg_pct_viewed as number)),
      // How much of the library Amazon actually reported on, so a partial
      // picture is never presented as the whole one.
      reportedViews: withViews.length,
      reportedRetention: withRetention.length,
    },
    deadWeight: { noViews, noProducts, notLive },
    byLength,
    months,
    topByViews: top(r => r.views),
    topByHearts: top(r => r.hearts),
  })
}
