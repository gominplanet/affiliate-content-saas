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
import { extractYouTubeVideoId } from '@/lib/youtube-url'
import { fetchYouTubeVideoSnippet } from '@/services/youtube'
import { listYouTubeChannels } from '@/lib/youtube-channels'

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

/** The short links that hide an ASIN behind a redirect. Matching one means the
 *  video HAS a product, so the answer is a lookup rather than a refusal. */
const SHORTENED = /(?:geni\.us|\bgnz\.|amzn\.to|a\.co\/|bit\.ly|tinyurl\.com|rebrand\.ly)/i

/**
 * Add one video to youtube_videos from its YouTube id.
 *
 * ONLY THE CREATOR'S OWN CHANNELS. The id comes from a pasted link, so without
 * this check anyone could pull any video on YouTube into their account and
 * push it to their storefront. The snippet carries the channel it belongs to,
 * and it has to be one of theirs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function adoptVideo(sb: any, userId: string, ytId: string): Promise<
  { id: string } | { error: Record<string, unknown>; status: number }
> {
  const key = process.env.YOUTUBE_API_KEY || ''
  if (!key) {
    return {
      error: { error: `MVP has no record of ${ytId}, and cannot look it up because the YouTube API key is not set.` },
      status: 503,
    }
  }

  const snippet = await fetchYouTubeVideoSnippet(key, ytId)
  if (!snippet) {
    // Deleted, private, or simply not a real id. Named as the lookup failing
    // rather than as the creator needing to sync something.
    return {
      error: { error: `YouTube returned nothing for ${ytId}. It may be private, deleted, or the link may be wrong.` },
      status: 404,
    }
  }

  const mine = await listYouTubeChannels(sb, userId)
  const ids = new Set(mine.map((c) => c.channelId).filter(Boolean))
  if (ids.size > 0 && !ids.has(snippet.channelId)) {
    return {
      error: {
        error: `That video is on ${snippet.channelTitle || 'another channel'}, which is not connected to this account.`,
        detail: 'Connect that channel on the YouTube page, then try again.',
      },
      status: 403,
    }
  }
  if (ids.size === 0) {
    // No connected channel at all. Refused rather than trusted, because the
    // ownership check is the only thing standing between a pasted link and
    // somebody else's video on this creator's storefront.
    return {
      error: {
        error: 'Connect your YouTube channel first, so MVP can confirm the video is yours.',
      },
      status: 403,
    }
  }

  // THE SAME SHAPE THE SYNC WRITES, and the same conflict target. An adopted
  // row has to be indistinguishable from a synced one, or the next channel sync
  // either duplicates it or overwrites half its columns. Upsert also settles the
  // race where the sync reaches this video between the lookup and the insert.
  const { data: made, error: insErr } = await sb.from('youtube_videos').upsert({
    user_id: userId,
    youtube_video_id: snippet.youtubeVideoId,
    title: snippet.title,
    description: snippet.description,
    thumbnail_url: snippet.thumbnailUrl,
    channel_id: snippet.channelId,
    channel_title: snippet.channelTitle,
    published_at: snippet.publishedAt,
    duration_seconds: snippet.durationSeconds,
  }, { onConflict: 'user_id,youtube_video_id' }).select('id').single()
  if (insErr || !made) {
    return { error: { error: 'Could not add that video.', detail: insErr?.message ?? null }, status: 500 }
  }
  return { id: made.id }
}

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

  const body = await req.json().catch(() => ({})) as {
    domains?: string[]; domain?: string; onlyVideo?: string
  }
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

  // ── ONE VIDEO, for trying the whole path end to end ──────────────────────
  //
  // The catalogue is the point of this feature, but a creator's first question
  // is "does this actually work", and answering it should not mean starting a
  // 3000 video run and waiting. A pasted link runs the identical code on one
  // row: same enumeration, same scanner, same queue, same delivery.
  let onlyVideoId: string | null = null
  if (body.onlyVideo) {
    const ytId = extractYouTubeVideoId(String(body.onlyVideo))
    if (!ytId) {
      return NextResponse.json({
        error: 'That does not look like a YouTube link. Paste the watch, youtu.be, Shorts or Studio URL.',
      }, { status: 400 })
    }
    // NOT maybeSingle(). It returns an ERROR, not a row, the moment two rows
    // match, and a catalogue with the same video imported twice is common
    // enough that a duplicate read as "MVP has no record of this video". The
    // newest row wins, which is the one every other feature would pick.
    const { data: hits, error: lookErr } = await sb.from('youtube_videos')
      .select('id,created_at').eq('user_id', user.id).eq('youtube_video_id', ytId)
      .order('created_at', { ascending: false }).limit(1)
    if (lookErr) {
      // The database's own words. Reporting this as "no record" would send the
      // creator to re-sync a channel over a query that never ran.
      return NextResponse.json({
        error: 'Could not look that video up.', detail: lookErr.message,
      }, { status: 500 })
    }
    if (!Array.isArray(hits) || hits.length === 0) {
      // PULL IT IN RATHER THAN REFUSING.
      //
      // The channel sync pages fifty videos at a time, so on a 3000 video
      // channel a video can be perfectly real and simply not reached yet.
      // Telling the creator to go and sync first, for one video whose id we are
      // holding, is asking them to do work MVP can do in one API call.
      const pulled = await adoptVideo(sb, user.id, ytId)
      if ('error' in pulled) return NextResponse.json(pulled.error, { status: pulled.status })
      onlyVideoId = pulled.id
    } else {
      onlyVideoId = hits[0].id
    }
  }

  // The markets come back with it: the screen adopts them, so the ticks and the
  // numbers underneath stop describing two different runs.
  const { data: open } = await sb.from('catalogue_runs')
    .select('id,domains,domain').eq('user_id', user.id).in('state', OPEN_STATES).limit(1)
  if (Array.isArray(open) && open.length > 0) {
    // A one-video test is explicit about what it wants, so silently handing
    // back somebody's 3000 video run instead would be the stale-ticks bug over
    // again. It says what is in the way and what to press.
    if (onlyVideoId) {
      return NextResponse.json({
        error: 'You already have a run open. Press Start a different run to close it, then try the single video.',
      }, { status: 409 })
    }
    const its: string[] = Array.isArray(open[0].domains) && open[0].domains.length > 0
      ? open[0].domains
      : [open[0].domain].filter(Boolean)
    return NextResponse.json({ ok: true, runId: open[0].id, resumed: true, domains: its })
  }

  // The true size of the catalogue, read before the capped fetch, so the screen
  // can tell the creator when it is looking at a slice.
  const { count: total } = onlyVideoId ? { count: 1 } : await sb
    .from('youtube_videos').select('id', { count: 'exact', head: true }).eq('user_id', user.id)

  // MVP's OWN video table, not the channel listing, and deliberately so: this is
  // where the product link lives, and a video with no product cannot be
  // delivered to a storefront at all.
  let q = sb
    .from('youtube_videos')
    .select('id,youtube_video_id,title,description,asin,product_url,created_at')
    .eq('user_id', user.id)
  if (onlyVideoId) q = q.eq('id', onlyVideoId)
  const { data: videos } = await q.order('created_at', { ascending: false }).limit(CAP)

  const rows = Array.isArray(videos) ? videos : []
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No videos found on your account yet.' }, { status: 400 })
  }

  const { data: run } = await sb.from('catalogue_runs')
    .insert({
      user_id: user.id, domain: domains[0], domains, state: 'scanning',
      detail: onlyVideoId ? 'one video' : null,
    })
    .select('id').single()
  if (!run) return NextResponse.json({ error: 'Could not start the run.' }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: Array<Record<string, any>> = []
  let scannable = 0
  for (const v of rows) {
    const base = { run_id: run.id, user_id: user.id, video_id: v.id, youtube_video_id: v.youtube_video_id || null }

    // THE PRODUCT, IN THREE PASSES, TWO OF THEM FREE.
    //
    // youtube_videos.asin is only written at blog-generation time and by the
    // CC-badge backfill, so on most of a catalogue it is empty. product_url
    // (migration 052) is where /api/global-sync/start reads it from. And the
    // YouTube description, which MVP never wrote and so never emptied, very
    // often carries the buy link the creator put there themselves.
    //
    // Gating on the asin column alone reported "no product attached" for 885 of
    // one creator's 1000 videos. Adding product_url moved that by one. The
    // description is the third place, and a short link is the fourth: those
    // cannot be read without a network hop, so they are handed to the scanner
    // rather than written off here.
    const text = `${v.product_url ?? ''}\n${v.description ?? ''}`
    const asin = (v.asin as string | null)?.trim()
      || asinFromAmazonUrl(String(v.product_url ?? ''))
      || asinFromAmazonUrl(String(v.description ?? ''))

    if (!v.youtube_video_id) {
      items.push({ ...base, domain: WHOLE_VIDEO, state: 'skipped',
        reason: 'not on YouTube, so there is no dubbed track to pull' })
      continue
    }
    if (!asin) {
      // A SHORT LINK IS A PRODUCT, JUST NOT A READABLE ONE. geni.us and amzn.to
      // hide the ASIN behind a redirect, which is exactly why migration 204
      // exists. Calling that "no product attached" blames the creator for a
      // lookup MVP simply had not done yet.
      if (SHORTENED.test(text)) {
        items.push({ ...base, domain: WHOLE_VIDEO, state: 'resolving',
          reason: 'following the product link to find the ASIN' })
        continue
      }
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
    onlyVideo: !!onlyVideoId,
    scannable,
    skipped: rows.length - scannable,
  })
}
