/**
 * GET /api/proxy-short/[videoId] — serve a vertical MP4 from MVP's
 * verified domain so TikTok's Content Posting API will accept it as the
 * PULL_FROM_URL source.
 *
 * TikTok rejects `PULL_FROM_URL` whenever the source domain isn't
 * verified under Content Posting API → Domain Verification. We only
 * verified mvpaffiliate.io, not *.supabase.co, so a direct Supabase
 * Storage URL fails with `url_ownership_unverified`.
 *
 * This route bridges that: the actual MP4 lives in Supabase Storage,
 * but TikTok pulls from https://www.mvpaffiliate.io/api/proxy-short/<id>
 * — which IS on our verified domain. We stream the upstream bytes
 * through without buffering the full file in memory.
 *
 * Auth: none. The videoId is a Supabase UUID — practically unguessable,
 * and the only thing returned is the MP4 the user already chose to host
 * on a public-read Supabase bucket. Same effective exposure as the raw
 * Supabase URL.
 *
 * Caching: 1h public, since TikTok may retry the pull and we'd rather
 * Vercel's edge cache shoulders the bandwidth than our Node function.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Stream the full upstream MP4. TikTok's pull can take 30-60s for a
// large file on a slow inbound connection.
export const maxDuration = 300

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await params
  if (!videoId || !/^[0-9a-f-]{36}$/i.test(videoId)) {
    return NextResponse.json({ error: 'Invalid videoId' }, { status: 400 })
  }

  // Service role — no user context to scope by since TikTok hits this
  // route unauthenticated.
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (admin as any)
    .from('youtube_videos')
    .select('instagram_video_url')
    .eq('id', videoId)
    .maybeSingle()
  const upstreamUrl = row?.instagram_video_url as string | undefined
  if (!upstreamUrl || !/^https:\/\//.test(upstreamUrl)) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 })
  }

  // Sanity check: only proxy URLs that look like our Supabase Storage
  // hostname. Without this someone could use this route as an open
  // proxy. (Service-role-fetched URLs should always match, but cheap
  // safety belt.)
  try {
    const host = new URL(upstreamUrl).hostname
    if (!host.endsWith('.supabase.co') && !host.endsWith('.supabase.in')) {
      return NextResponse.json({ error: 'Unsupported upstream host' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Bad upstream URL' }, { status: 400 })
  }

  // Stream-fetch from Supabase. We don't buffer — TikTok consumes the
  // response in chunks the same way.
  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl)
  } catch (e) {
    return NextResponse.json({
      error: `Upstream fetch failed: ${e instanceof Error ? e.message : 'unknown'}`,
    }, { status: 502 })
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({
      error: `Upstream returned ${upstream.status}`,
    }, { status: 502 })
  }

  // Pass through Content-Type + Content-Length so TikTok's pre-flight
  // size check passes. Hardcode MP4 if upstream doesn't report it.
  const contentType = upstream.headers.get('content-type') || 'video/mp4'
  const contentLength = upstream.headers.get('content-length') || undefined

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    // 1h edge cache — TikTok retries shouldn't re-burn our function time.
    'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    // CORS open so the same URL can also be used as an HTML5 video src
    // on the modal preview without browser blocks.
    'Access-Control-Allow-Origin': '*',
  }
  if (contentLength) headers['Content-Length'] = contentLength

  return new NextResponse(upstream.body, {
    status: 200,
    headers,
  })
}
