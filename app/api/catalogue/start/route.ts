// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/catalogue/start — begin a back-catalogue push to one marketplace.
//   body: { domain }  ->  { ok, runId, videos } | { error }
//
// Enumerates the creator's videos and writes one pending item each. It does NOT
// check the audio tracks here: each check is a yt-dlp call through the proxy,
// and doing 500 of them inside one request would time out, hammer YouTube's bot
// wall, and spend the whole budget before the creator saw a single result.
// /api/cron/catalogue-scan works through them a few at a time instead.
//
// Every video gets a row, including the ones that will turn out to be
// ineligible. The skipped list is the useful half of the report.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { marketByDomain } from '@/lib/markets'

export const runtime = 'nodejs'
export const maxDuration = 60

/** A guard on the creator, not on us: one run per market at a time keeps the
 *  report readable and stops a double click from queueing everything twice. */
const OPEN_STATES = ['queued', 'scanning']

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  if (!['pro', 'admin'].includes(tier)) {
    return NextResponse.json({ error: 'Back catalogue is a Pro feature.', code: 'tier_not_allowed' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { domain?: string }
  const domain = (body.domain || '').trim()
  const market = marketByDomain(domain)
  if (!market) return NextResponse.json({ error: 'Pick a marketplace to deliver to.' }, { status: 400 })
  if (!market.needsTranslation) {
    // An English market needs no dub, so every video is already eligible and
    // this feature has nothing to add over the normal storefront sync.
    return NextResponse.json({
      error: `${market.country} speaks English, so your videos need no dub for it. Use Storefront Sync for that market.`,
    }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: open } = await sb.from('catalogue_runs')
    .select('id').eq('user_id', user.id).eq('domain', domain).in('state', OPEN_STATES).limit(1)
  if (Array.isArray(open) && open.length > 0) {
    return NextResponse.json({ ok: true, runId: open[0].id, resumed: true })
  }

  // MVP's OWN video table, not the channel listing, and deliberately so: this
  // is where the ASIN lives (migration 204), and a video with no product
  // attached cannot be delivered to a storefront at all. Enumerating the raw
  // channel would add hundreds of rows that could only ever be skipped for the
  // same reason.
  const { data: videos } = await sb
    .from('youtube_videos')
    .select('id,youtube_video_id,title,asin,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1000)

  const rows = Array.isArray(videos) ? videos : []
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No videos found on your account yet.' }, { status: 400 })
  }

  const { data: run } = await sb.from('catalogue_runs')
    .insert({ user_id: user.id, domain, state: 'scanning' })
    .select('id').single()
  if (!run) return NextResponse.json({ error: 'Could not start the run.' }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = rows.map((v: any) => ({
    run_id: run.id,
    user_id: user.id,
    video_id: v.id,
    youtube_video_id: v.youtube_video_id || null,
    // Decided here, because it needs no network call. A video with no YouTube
    // id was uploaded to MVP directly and has no track to pull; one with no
    // ASIN has nothing to point a storefront listing at. Both are final
    // answers, so they never reach the scanner and never cost a lookup.
    state: (!v.youtube_video_id || !v.asin) ? 'skipped' : 'pending',
    reason: !v.youtube_video_id
      ? 'not on YouTube, so there is no dubbed track to pull'
      : !v.asin
        ? 'no product attached, so there is nothing for the listing to point at'
        : null,
  }))

  // Chunked: a single insert of a thousand rows is rejected by PostgREST's
  // payload limit on a large catalogue.
  for (let i = 0; i < items.length; i += 200) {
    await sb.from('catalogue_run_items').insert(items.slice(i, i + 200))
  }

  return NextResponse.json({
    ok: true,
    runId: run.id,
    videos: rows.length,
    pending: items.filter((i) => i.state === 'pending').length,
    skipped: items.filter((i) => i.state === 'skipped').length,
  })
}
