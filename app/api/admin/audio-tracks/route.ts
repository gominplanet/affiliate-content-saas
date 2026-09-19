// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/audio-tracks?v=<youtube url or id>
//
// Answers one question: does YouTube hand us the dubbed audio tracks it shows
// in Studio, or only the original?
//
// It exists because the answer decides whether Global Storefront Sync can stop
// paying to synthesize dubs, and because the only other way to find out was a
// yt-dlp command on a box nobody logs into. A question the product depends on
// should be answerable by opening a page.
//
// Metadata only. Nothing is downloaded and nothing is spent.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { listYouTubeAudioTracks, ingestConfigured } from '@/lib/youtube-ingest'
import { MARKETS } from '@/lib/markets'
import { extractYouTubeVideoId } from '@/lib/youtube-url'

export async function GET(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const videoId = extractYouTubeVideoId(request.nextUrl.searchParams.get('v') || '')
  if (!videoId) {
    return NextResponse.json({ error: 'Paste a YouTube link or an 11-character video id.' }, { status: 400 })
  }

  // "Not configured" is its own answer. Reporting it as "no tracks" would say
  // this video has no dubs when what actually happened is that we never looked,
  // and those two lead to opposite decisions about spending a dub credit.
  if (!ingestConfigured()) {
    return NextResponse.json({
      ok: false,
      videoId,
      reason: 'not_configured',
      message: 'The video service is not switched on in this environment, so nothing was checked. This is not a finding about the video.',
    })
  }

  const info = await listYouTubeAudioTracks(videoId)
  if (!info) {
    return NextResponse.json({
      ok: false,
      videoId,
      reason: 'lookup_failed',
      message: 'The lookup did not come back. That is a failure to check, not a video without dubs. Usually YouTube asking the downloader to sign in, which means its cookies need refreshing.',
    })
  }

  // Which Amazon markets this video could be dubbed into for free, named rather
  // than left as language codes, since the markets are the point.
  const freeMarkets = MARKETS
    .filter((m) => m.needsTranslation)
    .filter((m) => {
      const want = (m.lang || '').split('-')[0].toLowerCase()
      return !!want && info.languages.some((l) => l.toLowerCase().startsWith(want))
    })
    .map((m) => ({ domain: m.domain, country: m.country, langName: m.langName }))

  return NextResponse.json({
    ok: true,
    videoId,
    languages: info.languages,
    originalLanguage: info.originalLanguage,
    multiTrack: info.multiTrack,
    freeMarkets,
    // The headline, written here so the page states a conclusion rather than
    // leaving a reader to work one out from a list of language codes.
    verdict: info.multiTrack
      ? `YouTube serves ${info.languages.length} audio tracks for this video, so its dubs ARE downloadable. ${freeMarkets.length} Amazon market${freeMarkets.length === 1 ? '' : 's'} can be dubbed for free.`
      : 'YouTube serves one audio track for this video, so there is no dub to pull. Storefront Sync will synthesize one as before.',
  })
}
