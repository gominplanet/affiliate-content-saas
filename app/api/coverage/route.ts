// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/coverage — the map. How much of this creator's catalogue is earning
// in each country they ticked, and what the rest is waiting on.
//
// NO NUMBER HERE IS A PAGE LENGTH. The run model's status route counted the
// rows it had fetched, and PostgREST caps a response at 1000, so a thousand
// video catalogue reported "472 of 583". Every count here comes from a count
// query; the only rows read are the handful needed to draw the ready list.
//
// THE HEADLINE IS THE ONE THAT MATTERS. Not how many were scanned, not a
// percentage: how many of your videos are earning somewhere beyond your home
// market. That is the number the whole feature exists to move.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { marketByDomain } from '@/lib/markets'
import { decodeHtmlEntities } from '@/lib/decode-entities'
import { signinLabel, canDeliver } from '@/lib/storefront-coverage'

export const runtime = 'nodejs'

/** Rows read for the "ready to upload" list. Everything else is counted. */
const READY_SHOWN = 60

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: mkts } = await sb.from('storefront_markets')
    .select('domain,enabled,signin_state,signin_detail').eq('user_id', user.id).eq('enabled', true)
  const enabled: Array<{ domain: string; signin_state: string; signin_detail: string | null }> = mkts ?? []

  const { data: raw, error: sumErr } = await sb.rpc('storefront_coverage_summary', { p_user: user.id })
  if (sumErr) {
    // SAID, not swallowed. A screen quietly showing zeros is worse than one
    // saying the count could not be read.
    return NextResponse.json({
      error: 'Could not read your coverage. Run migration 352, then reload.',
      detail: sumErr.message,
    }, { status: 500 })
  }

  type Bucket = { domain: string; state: string; reason: string | null; n: number }
  const summary = (raw ?? {}) as {
    videos?: number; videosAbroad?: number; buckets?: Bucket[]
  }
  const buckets: Bucket[] = Array.isArray(summary.buckets) ? summary.buckets : []
  const sum = (f: (b: Bucket) => boolean) =>
    buckets.filter(f).reduce((n, b) => n + Number(b.n || 0), 0)

  const markets = enabled.map((m) => {
    const mine = (s: string) => sum((b) => b.domain === m.domain && b.state === s)
    const info = marketByDomain(m.domain)
    return {
      domain: m.domain,
      country: info?.country ?? m.domain,
      langName: info?.langName ?? null,
      signin: m.signin_state,
      signinLabel: signinLabel(m.signin_state),
      deliverable: canDeliver(m.signin_state),
      live: mine('live'),
      uploaded: mine('uploaded'),
      ready: mine('ready'),
      preparing: mine('preparing') + mine('unknown'),
      blocked: mine('blocked'),
      // Grouped, because "not sold in this country" and "no product attached"
      // send the creator to do completely different things, and one of them is
      // not their problem at all.
      blockedReasons: buckets
        .filter((b) => b.domain === m.domain && b.state === 'blocked')
        .map((b) => ({ reason: b.reason || 'no reason recorded', count: Number(b.n || 0) }))
        .sort((a, b) => b.count - a.count),
    }
  })

  // ── what is waiting for SCOUT right now ───────────────────────────────────
  // Only for markets the creator can actually reach. A ready listing in a
  // country they are not signed in to is not ready for anything, and listing it
  // as such is how a queue looks busy while nothing moves.
  const deliverable = markets.filter((m) => m.deliverable).map((m) => m.domain)
  let readyNow: Array<{ id: string; videoId: string; domain: string; country: string; title: string; thumbnail: string | null }> = []
  if (deliverable.length > 0) {
    const { data: rows } = await sb.from('storefront_coverage')
      .select('id,video_id,domain')
      .eq('user_id', user.id).eq('state', 'ready').in('domain', deliverable)
      .order('priority', { ascending: false }).limit(READY_SHOWN)
    const ids = [...new Set((rows ?? []).map((r: { video_id: string }) => r.video_id))]
    const titles = new Map<string, { title: string; thumb: string | null }>()
    if (ids.length > 0) {
      const { data: vids } = await sb.from('youtube_videos')
        .select('id,title,thumbnail_url').eq('user_id', user.id).in('id', ids)
      for (const v of (vids ?? [])) {
        // Titles come off YouTube as "I&#39;ve" and render exactly like that.
        titles.set(v.id, { title: decodeHtmlEntities(v.title || '') || '(untitled)', thumb: v.thumbnail_url ?? null })
      }
    }
    readyNow = (rows ?? []).map((r: { id: string; video_id: string; domain: string }) => ({
      id: r.id,
      videoId: r.video_id,
      domain: r.domain,
      country: marketByDomain(r.domain)?.country ?? r.domain,
      title: titles.get(r.video_id)?.title ?? '(untitled)',
      thumbnail: titles.get(r.video_id)?.thumb ?? null,
    }))
  }

  const totalReady = markets.filter((m) => m.deliverable).reduce((n, m) => n + m.ready, 0)
  // Ready, but in a market SCOUT cannot reach. Counted separately so it never
  // hides inside a number that says work is about to happen.
  const readyButUnreachable = markets.filter((m) => !m.deliverable).reduce((n, m) => n + m.ready, 0)

  return NextResponse.json({
    ok: true,
    // THE HEADLINE. Videos earning in at least one ticked market, out of every
    // video on the account.
    headline: {
      videos: Number(summary.videos || 0),
      earningAbroad: Number(summary.videosAbroad || 0),
    },
    markets,
    ready: { total: totalReady, unreachable: readyButUnreachable, items: readyNow },
    marketsTicked: enabled.length,
  })
}
