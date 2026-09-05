// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/amazon-videos/insights — what the creator's Amazon video library says
// about their business.
//
// The earnings tables answer "how much". This answers the questions that decide
// what to shoot next, from data Amazon already recorded and never shows back:
//
//   Is Amazon still showing my videos?  median views per video, by publish month
//   Does holding attention buy reach?   views, banded by percent watched
//   What did people actually love?      hearts per thousand views
//   Which uploads are dead weight?      no views, never live, and when
//   Does publishing more pay?           videos per month against earnings
//   What is my best work?               ranked by views and by hearts
//
// This file now only fetches. Every calculation lives in lib/video-insights.ts
// as a pure function, because arithmetic welded to a database is arithmetic
// nobody can test, and untested arithmetic is what put "every video is 0s long"
// and "6,700 videos have no product" in front of a creator.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { analyseVideoLibrary, type VideoRow, type EarningRow } from '@/lib/video-insights'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

  if (!rows.length) return NextResponse.json({ ok: true, videos: 0 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: earn } = await (supabase as any)
    .from('amazon_earnings_periods')
    .select('period_start,earnings_cents,store_scope')
    .eq('user_id', user.id)

  return NextResponse.json(analyseVideoLibrary(rows, (earn ?? []) as EarningRow[]))
}
