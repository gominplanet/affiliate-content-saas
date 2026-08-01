// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/blog/instagram-cover?videoId=…   → { offsetMs, videoUrl }
// POST /api/blog/instagram-cover  { videoId, offsetMs }   → { ok, offsetMs }
//
// The Reel COVER frame the creator picks in MVP (milliseconds into the 9:16
// render). Stored on youtube_videos.ig_cover_offset_ms and passed as
// `thumb_offset` at publish, so a Reel goes out with the chosen still instead of
// IG's default first frame. GET also returns the vertical MP4 url so the picker
// can scrub the same render that will be posted. Pass offsetMs = null to clear.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth) return auth.error
  const { ownerId } = auth

  const videoId = (new URL(request.url).searchParams.get('videoId') || '').trim()
  if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: v } = await (supabase as any)
    .from('youtube_videos')
    .select('id, instagram_video_url, ig_cover_offset_ms')
    .eq('id', videoId)
    .eq('user_id', ownerId)
    .maybeSingle()
  if (!v) return NextResponse.json({ error: 'Video not found' }, { status: 404 })

  return NextResponse.json({
    ok: true,
    videoUrl: v.instagram_video_url ?? null,
    offsetMs: v.ig_cover_offset_ms ?? null,
  })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth) return auth.error
  const { ownerId } = auth

  const body = await request.json().catch(() => ({})) as { videoId?: string; offsetMs?: number | null }
  const videoId = (body.videoId || '').trim()
  if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 })

  // Clamp to a sane integer ms; null clears the pick (back to IG default).
  let offsetMs: number | null = null
  if (body.offsetMs != null && Number.isFinite(body.offsetMs)) {
    offsetMs = Math.max(0, Math.round(body.offsetMs))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('youtube_videos')
    .update({ ig_cover_offset_ms: offsetMs })
    .eq('id', videoId)
    .eq('user_id', ownerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, offsetMs })
}
