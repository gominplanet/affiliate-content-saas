/**
 * POST /api/instagram/burn/save-download
 *
 * Persist a Short's vertical MP4 (that SCOUT just downloaded from the creator's
 * own YouTube Studio and the browser uploaded to storage) onto the youtube_videos
 * row, so the Short flips from "Needs download" to "Ready to burn" and the file is
 * reusable across sessions.
 *
 * Body: { videoId: string (youtube_videos.id), videoUrl: string (storage URL) }
 *
 * The bytes never pass through this route — the browser uploads straight to
 * Supabase storage (no Vercel 4.5MB body limit) and we only record the URL. We
 * validate the URL points at OUR storage bucket so a caller can't stash an
 * arbitrary link.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { videoId?: string; videoUrl?: string }
  const videoId = (body.videoId || '').trim()
  const videoUrl = (body.videoUrl || '').trim()
  if (!videoId || !videoUrl) {
    return NextResponse.json({ error: 'videoId and videoUrl are required' }, { status: 400 })
  }

  // Only accept a public URL in OUR Supabase storage (the instagram-videos
  // bucket the browser uploaded to) — never an arbitrary external link.
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
  const allowedPrefix = `${base}/storage/v1/object/public/instagram-videos/`
  if (!base || !videoUrl.startsWith(allowedPrefix)) {
    return NextResponse.json({ error: 'videoUrl must be an uploaded storage URL' }, { status: 400 })
  }

  // Persist only on a row the user owns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error } = await (supabase as any)
    .from('youtube_videos')
    .update({ instagram_video_url: videoUrl })
    .eq('id', videoId)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'Video not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
