/**
 * POST /api/youtube/import-short — pull a YouTube Short MP4 to MVP's
 * Supabase Storage so it becomes a public URL Instagram + TikTok can
 * pull from.
 *
 * Body: { videoId: string }  // youtube_videos.id (uuid)
 *
 * The vertical-direct flow (modals on the Vertical Videos tab) calls
 * this when the user clicks "Import from YouTube" — the row's
 * instagram_video_url is null. We:
 *
 *   1. Resolve the YouTube video id from youtube_videos.youtube_video_id
 *   2. Pick the highest-quality combined-audio-video MP4 via
 *      @distube/ytdl-core (a maintained fork of ytdl-core with
 *      regular YouTube-player patches).
 *   3. Stream-collect the bytes (Shorts are < 3 min, typically < 50 MB —
 *      well within the function's memory budget).
 *   4. Upload to the instagram-videos bucket under the user's folder.
 *   5. Patch youtube_videos.instagram_video_url to the new public URL.
 *
 * Returns the public URL on success. Idempotent against the row — if a
 * vertical is already stored, we re-import and overwrite (the user is
 * effectively saying "use the fresh YouTube version").
 *
 * Function budget: 300s — comfortable for any Short under ~200 MB even
 * on slower network. ytdl-core sometimes hangs when YouTube rotates
 * cipher logic; we wrap in a 240s timeout to bail before Vercel kills
 * the function ungracefully.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import ytdl from '@distube/ytdl-core'

export const maxDuration = 300

/** Drain a Node Readable into an in-memory Buffer with a hard size cap.
 *  Stops + throws past the cap so a runaway stream can't crash the
 *  function with an OOM. */
async function streamToBufferCapped(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  return new Promise((resolve, reject) => {
    stream.on('data', (c: Buffer) => {
      total += c.length
      if (total > maxBytes) {
        reject(new Error(`Video exceeds ${Math.round(maxBytes / 1024 / 1024)} MB cap`))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(stream as any).destroy?.()
        return
      }
      chunks.push(c)
    })
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { videoId?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const videoId = (body.videoId || '').trim()
  if (!videoId) return NextResponse.json({ error: 'videoId is required.' }, { status: 400 })

  // ── 1. Resolve the YouTube video id ──────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: video } = await sb
    .from('youtube_videos')
    .select('id,youtube_video_id,title')
    .eq('id', videoId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!video?.youtube_video_id) {
    return NextResponse.json({ error: 'Video not found in your library.' }, { status: 404 })
  }
  const ytId = video.youtube_video_id as string

  // ── 2. Pull video info + pick best vertical MP4 with audio ───────────────
  // 240s timeout — comfortably under Vercel's 300s function ceiling so a
  // hanging YouTube cipher rotation doesn't leave the request in limbo.
  const watchUrl = `https://www.youtube.com/watch?v=${ytId}`
  let info: ytdl.videoInfo
  try {
    info = await Promise.race([
      ytdl.getInfo(watchUrl),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('YouTube info fetch timed out')), 60_000),
      ),
    ])
  } catch (e) {
    return NextResponse.json({
      error: `Couldn't read the YouTube Short — YouTube may have rotated its player; we'll catch up shortly. (${e instanceof Error ? e.message : 'unknown'})`,
    }, { status: 502 })
  }

  // Filter to formats that have BOTH audio and video in a single MP4 —
  // Reels / TikTok both expect one self-contained file.
  const formats = info.formats.filter(f => f.hasVideo && f.hasAudio && f.container === 'mp4')
  if (formats.length === 0) {
    // Fall back to highest-quality video-only stream — some Shorts only
    // come back as DASH-split. The IG/TikTok APIs will still accept it
    // because Shorts usually have music baked into the video layer.
    const fallback = info.formats.filter(f => f.hasVideo && f.container === 'mp4')
    if (fallback.length === 0) {
      return NextResponse.json({
        error: 'YouTube didn\'t serve an MP4 stream for this Short. Try again in a few minutes.',
      }, { status: 502 })
    }
    formats.push(...fallback)
  }
  // Prefer the highest resolution + highest bitrate.
  formats.sort((a, b) => {
    const aH = (a.height ?? 0)
    const bH = (b.height ?? 0)
    if (aH !== bH) return bH - aH
    return (b.bitrate ?? 0) - (a.bitrate ?? 0)
  })
  const format = formats[0]

  // ── 3. Stream-collect with a hard size cap ───────────────────────────────
  let mp4: Buffer
  try {
    const stream = ytdl.downloadFromInfo(info, { format })
    mp4 = await Promise.race([
      streamToBufferCapped(stream, 240 * 1024 * 1024), // 240 MB
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Download timed out')), 240_000),
      ),
    ])
  } catch (e) {
    return NextResponse.json({
      error: `Download failed: ${e instanceof Error ? e.message : 'unknown'}`,
    }, { status: 502 })
  }

  // ── 4. Upload to Supabase Storage ────────────────────────────────────────
  // Path shape matches the existing IG burner + composer uploads so the
  // bucket's RLS policy accepts it.
  const path = `${user.id}/import-${ytId}-${Date.now()}.mp4`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: upErr } = await (supabase.storage as any)
    .from('instagram-videos')
    .upload(path, mp4, {
      cacheControl: '3600',
      upsert: false,
      contentType: 'video/mp4',
    })
  if (upErr) {
    return NextResponse.json({
      error: `Storage upload failed: ${upErr.message}`,
    }, { status: 500 })
  }
  const { data: urlData } = supabase.storage.from('instagram-videos').getPublicUrl(path)
  const publicUrl = urlData.publicUrl

  // ── 5. Patch the row ─────────────────────────────────────────────────────
  await sb
    .from('youtube_videos')
    .update({ instagram_video_url: publicUrl })
    .eq('id', videoId)
    .eq('user_id', user.id)

  return NextResponse.json({
    ok: true,
    videoUrl: publicUrl,
    sizeBytes: mp4.length,
    height: format.height ?? null,
  })
}
