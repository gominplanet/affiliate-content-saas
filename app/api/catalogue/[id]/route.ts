// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/catalogue/[id] — a run's state, with the skipped videos named.
//
// The counts alone would let the screen say "197 of 525", which is the number
// Mark's bulk scan gives and it is not an answer: it leaves 328 videos with no
// explanation. Every skipped item carries its reason, grouped, because "no
// German track" and "no product attached" are different problems and only one
// of them is something the creator can fix.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { marketByDomain } from '@/lib/markets'

export const runtime = 'nodejs'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: run } = await sb.from('catalogue_runs')
    .select('id,domain,state,detail,created_at')
    .eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!run) return NextResponse.json({ error: 'Run not found.' }, { status: 404 })

  const { data: items } = await sb.from('catalogue_run_items')
    .select('id,state,reason,video_id,youtube_video_id,sync_job_id')
    .eq('run_id', id).eq('user_id', user.id)

  const rows = Array.isArray(items) ? items : []
  const count = (s: string) => rows.filter((r: { state: string }) => r.state === s).length

  // Titles for the eligible list, so the creator recognises what is about to go
  // out rather than reading a column of video ids.
  const eligibleRows = rows.filter((r: { state: string }) => r.state === 'eligible')
  const titles = new Map<string, string>()
  if (eligibleRows.length > 0) {
    const { data: vids } = await sb.from('youtube_videos')
      .select('id,title').eq('user_id', user.id)
      .in('id', eligibleRows.slice(0, 200).map((r: { video_id: string }) => r.video_id))
    for (const v of (vids ?? [])) titles.set(v.id, v.title)
  }

  // Grouped rather than listed one by one: 328 rows of "no German audio track"
  // is not more informative than one line saying 328, and it buries the
  // handful of reasons that ARE actionable.
  const skippedBy = new Map<string, number>()
  for (const r of rows) {
    if (r.state !== 'skipped') continue
    const key = (r.reason as string) || 'no reason recorded'
    skippedBy.set(key, (skippedBy.get(key) ?? 0) + 1)
  }

  const market = marketByDomain(run.domain)

  return NextResponse.json({
    ok: true,
    run: {
      id: run.id,
      domain: run.domain,
      country: market?.country ?? run.domain,
      langName: market?.langName ?? null,
      state: run.state,
      createdAt: run.created_at,
    },
    totals: {
      videos: rows.length,
      pending: count('pending'),
      eligible: eligibleRows.length,
      skipped: count('skipped'),
      queued: count('queued'),
      delivered: count('delivered'),
      failed: count('failed'),
    },
    eligible: eligibleRows.slice(0, 200).map((r: { id: string; video_id: string; youtube_video_id: string | null }) => ({
      itemId: r.id,
      videoId: r.video_id,
      youtubeVideoId: r.youtube_video_id,
      title: titles.get(r.video_id) ?? '(untitled)',
    })),
    skippedReasons: [...skippedBy.entries()]
      .map(([reason, n]) => ({ reason, count: n }))
      .sort((a, b) => b.count - a.count),
  })
}
