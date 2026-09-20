// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/catalogue/[id] — a run's state, as one row per video with a verdict
// per marketplace, plus the counts.
//
// PER VIDEO, because the answer is per video. A creator looking at their back
// catalogue wants to see "this one can go to Germany free and to France for a
// dub", which is a row about a video, not a bucket it fell into. The aggregate
// counts stay because a thousand cards need a summary above them.
//
// THREE VERDICTS PER MARKET, not two:
//   eligible  YouTube already dubbed it, so the track is pulled and it is free
//   paid      no track, so MVP dubs it, the same lane Launchpad has always used
//   skipped   it genuinely cannot go: the run's market is unusable
// and one verdict about the VIDEO (no product attached, not on YouTube), stored
// once on a row with no domain because it is true of every market.
//
// A percentage would say none of this. "197 of 525" is what a bulk scanner
// reports and it leaves 328 videos unexplained, half of them for a reason the
// creator could fix in a minute.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { marketByDomain } from '@/lib/markets'

export const runtime = 'nodejs'

/** Cards sent to the browser. The counts above them are computed from every row,
 *  so a capped list never turns into a wrong total. */
const CARD_LIMIT = 250

type Item = {
  id: string; state: string; reason: string | null
  video_id: string; youtube_video_id: string | null; domain: string | null
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: run } = await sb.from('catalogue_runs')
    .select('id,domain,domains,state,detail,created_at')
    .eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!run) return NextResponse.json({ error: 'Run not found.' }, { status: 404 })

  const { data: items } = await sb.from('catalogue_run_items')
    .select('id,state,reason,video_id,youtube_video_id,domain')
    .eq('run_id', id).eq('user_id', user.id)

  const rows: Item[] = Array.isArray(items) ? items : []
  const domainList: string[] = Array.isArray(run.domains) && run.domains.length > 0
    ? run.domains
    : (run.domain ? [run.domain] : [])

  const blockedRows = rows.filter((r) => !r.domain)
  const marketRows = rows.filter((r) => !!r.domain)

  const group = (list: Item[]) => {
    const m = new Map<string, number>()
    for (const r of list) { const k = r.reason || 'no reason recorded'; m.set(k, (m.get(k) ?? 0) + 1) }
    return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
  }

  // ── one row per video ─────────────────────────────────────────────────────
  const byVideo = new Map<string, { blocked: string | null; markets: Map<string, Item> }>()
  for (const r of rows) {
    let v = byVideo.get(r.video_id)
    if (!v) { v = { blocked: null, markets: new Map() }; byVideo.set(r.video_id, v) }
    if (!r.domain) v.blocked = r.reason || 'not eligible'
    else v.markets.set(r.domain, r)
  }

  // Cards are the videos that can actually go somewhere, newest first, and a
  // blocked video is not one of them: its reason is in the summary above.
  const actionable = [...byVideo.entries()]
    .filter(([, v]) => !v.blocked && [...v.markets.values()].some((m) => m.state !== 'skipped'))
  const shown = actionable.slice(0, CARD_LIMIT)

  const titles = new Map<string, { title: string; thumb: string | null }>()
  if (shown.length > 0) {
    const { data: vids } = await sb.from('youtube_videos')
      .select('id,title,thumbnail_url,youtube_video_id').eq('user_id', user.id)
      .in('id', shown.map(([vid]) => vid))
    for (const v of (vids ?? [])) titles.set(v.id, { title: v.title, thumb: v.thumbnail_url ?? null })
  }

  const videos = shown.map(([videoId, v]) => ({
    videoId,
    title: titles.get(videoId)?.title ?? '(untitled)',
    thumbnail: titles.get(videoId)?.thumb ?? null,
    markets: domainList.map((domain) => {
      const item = v.markets.get(domain)
      const m = marketByDomain(domain)
      return {
        domain,
        country: m?.country ?? domain,
        langName: m?.langName ?? null,
        itemId: item?.id ?? null,
        // 'pending' until the lookup lands, then 'eligible' (free), 'paid'
        // (MVP dubs it), 'queued', 'delivered', 'failed' or 'skipped'.
        state: item?.state ?? 'pending',
        reason: item?.reason ?? null,
      }
    }),
  }))

  const perMarket = domainList.map((domain) => {
    const mine = marketRows.filter((r) => r.domain === domain)
    const n = (s: string) => mine.filter((r) => r.state === s).length
    const m = marketByDomain(domain)
    return {
      domain,
      country: m?.country ?? domain,
      langName: m?.langName ?? null,
      pending: n('pending'), free: n('eligible'), paid: n('paid'),
      skipped: n('skipped'), queued: n('queued'), delivered: n('delivered'), failed: n('failed'),
      failedReasons: group(mine.filter((r) => r.state === 'failed')),
    }
  })

  const videosTotal = byVideo.size
  const videosPending = new Set(marketRows.filter((r) => r.state === 'pending').map((r) => r.video_id)).size

  return NextResponse.json({
    ok: true,
    run: { id: run.id, domains: domainList, state: run.state, createdAt: run.created_at },
    videos: {
      total: videosTotal,
      checked: videosTotal - videosPending,
      pending: videosPending,
      blocked: blockedRows.length,
      actionable: actionable.length,
      shown: shown.length,
    },
    // Market-independent, listed once. "no product attached" is the creator's to
    // fix and "not on YouTube" is not, so they stay separate lines.
    blockedReasons: group(blockedRows),
    markets: perMarket,
    cards: videos,
    totals: {
      free: perMarket.reduce((n, m) => n + m.free, 0),
      paid: perMarket.reduce((n, m) => n + m.paid, 0),
      queued: perMarket.reduce((n, m) => n + m.queued, 0),
      delivered: perMarket.reduce((n, m) => n + m.delivered, 0),
      failed: perMarket.reduce((n, m) => n + m.failed, 0),
    },
  })
}
