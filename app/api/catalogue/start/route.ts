// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/catalogue/start — begin a back-catalogue push to one or more markets.
//   body: { domains: string[] }  ->  { ok, runId, videos, considered, total } | { error }
//
// SEVERAL MARKETS IN ONE RUN, because one track-list lookup answers every
// language at once. Checking a video for German and then again for French is the
// same yt-dlp call twice for an answer the first call already contained, so the
// run holds the markets and each video is looked at once.
//
// No track lookups happen here. Each one is a yt-dlp call through the proxy, and
// doing hundreds inside one request would time out, hammer YouTube's bot wall,
// and spend the whole budget before the creator saw a single result.
// /api/cron/catalogue-scan works through them a few at a time instead.
//
// Every video gets a row, including the ones that will turn out to be
// ineligible. The skipped list is the useful half of the report.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { marketByDomain } from '@/lib/markets'
import { asinFromAmazonUrl } from '@/lib/asin'

export const runtime = 'nodejs'
export const maxDuration = 60

/** A guard on the creator, not on us: one run at a time keeps the report
 *  readable and stops a double click from queueing everything twice. */
const OPEN_STATES = ['queued', 'scanning']

/** The newest N videos. A cap has to exist, and the one thing it must not do is
 *  look like a total: the screen is told how many there really are so it can say
 *  "the newest 2000 of 3412" rather than quietly presenting 2000 as the answer. */
const CAP = 2000

/** A verdict about the VIDEO rather than about one marketplace, stored on a row
 *  with no domain. Without this, "no product attached" would be counted once per
 *  chosen market and a five-market run would report it five times. */
const WHOLE_VIDEO = ''

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

  const body = await req.json().catch(() => ({})) as { domains?: string[]; domain?: string }
  const asked = Array.isArray(body.domains) ? body.domains : (body.domain ? [body.domain] : [])
  const domains = [...new Set(asked.map((d) => String(d || '').trim()).filter(Boolean))]
  if (domains.length === 0) return NextResponse.json({ error: 'Pick at least one marketplace.' }, { status: 400 })

  const unknown = domains.filter((d) => !marketByDomain(d))
  if (unknown.length > 0) {
    return NextResponse.json({ error: `MVP does not deliver to ${unknown.join(', ')}.` }, { status: 400 })
  }
  // An English market needs no dub, so every video is already eligible and this
  // feature has nothing to add over the normal storefront sync. Named, rather
  // than silently dropped from the selection.
  const english = domains.filter((d) => !marketByDomain(d)!.needsTranslation)
  if (english.length > 0) {
    const names = english.map((d) => marketByDomain(d)!.country).join(', ')
    return NextResponse.json({
      error: `${names} speaks English, so your videos need no dub there. Use Storefront Sync for those markets.`,
    }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: open } = await sb.from('catalogue_runs')
    .select('id').eq('user_id', user.id).in('state', OPEN_STATES).limit(1)
  if (Array.isArray(open) && open.length > 0) {
    return NextResponse.json({ ok: true, runId: open[0].id, resumed: true })
  }

  // The true size of the catalogue, read before the capped fetch, so the screen
  // can tell the creator when it is looking at a slice.
  const { count: total } = await sb
    .from('youtube_videos').select('id', { count: 'exact', head: true }).eq('user_id', user.id)

  // MVP's OWN video table, not the channel listing, and deliberately so: this is
  // where the product link lives, and a video with no product cannot be
  // delivered to a storefront at all.
  const { data: videos } = await sb
    .from('youtube_videos')
    .select('id,youtube_video_id,title,asin,product_url,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(CAP)

  const rows = Array.isArray(videos) ? videos : []
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No videos found on your account yet.' }, { status: 400 })
  }

  const { data: run } = await sb.from('catalogue_runs')
    .insert({ user_id: user.id, domain: domains[0], domains, state: 'scanning' })
    .select('id').single()
  if (!run) return NextResponse.json({ error: 'Could not start the run.' }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: Array<Record<string, any>> = []
  let scannable = 0
  for (const v of rows) {
    const base = { run_id: run.id, user_id: user.id, video_id: v.id, youtube_video_id: v.youtube_video_id || null }

    // THE PRODUCT, RESOLVED THE WAY THE SYNC PIPELINE RESOLVES IT.
    //
    // youtube_videos.asin is only written at blog-generation time and by the
    // CC-badge backfill, so on most of a catalogue it is empty. product_url
    // (migration 052) is the column that is actually populated, and
    // /api/global-sync/start reads the ASIN out of it with this same parser.
    // Gating on the asin column alone told a creator that 885 of his 1000
    // videos had no product attached when nearly all of them did.
    const asin = (v.asin as string | null)?.trim() || asinFromAmazonUrl(String(v.product_url ?? ''))

    if (!v.youtube_video_id) {
      items.push({ ...base, domain: WHOLE_VIDEO, state: 'skipped',
        reason: 'not on YouTube, so there is no dubbed track to pull' })
      continue
    }
    if (!asin) {
      items.push({ ...base, domain: WHOLE_VIDEO, state: 'skipped',
        reason: 'no product attached, so there is nothing for the listing to point at' })
      continue
    }
    // One row per market. They share a single lookup: the scanner reads the
    // track list once per video and answers every market's row from it.
    scannable++
    for (const domain of domains) {
      items.push({ ...base, domain, asin, state: 'pending', reason: null })
    }
  }

  // Chunked: a single insert of thousands of rows is rejected by PostgREST's
  // payload limit on a large catalogue.
  for (let i = 0; i < items.length; i += 500) {
    await sb.from('catalogue_run_items').insert(items.slice(i, i + 500))
  }

  return NextResponse.json({
    ok: true,
    runId: run.id,
    domains,
    videos: rows.length,
    total: total ?? rows.length,
    truncated: (total ?? 0) > rows.length,
    scannable,
    skipped: rows.length - scannable,
  })
}
