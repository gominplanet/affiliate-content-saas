/**
 * POST /api/youtube/upload-short — publish a vertical video to the creator's
 * YouTube channel as a Short (cross-post target). Feature-flagged: stays dark
 * until NEXT_PUBLIC_YOUTUBE_UPLOAD_ENABLED=true (set only after Google verifies
 * the youtube.upload scope and creators reconnect).
 *
 * Body: { videoUrl, title?, description?, privacyStatus?, channelId? }
 * Returns: { ok, videoId, url } | { error, reconnectRequired? }
 *
 * Pro-only. videoUrl is a vertical render we host (burner output / stored Short).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { youtubeUploadEnabled } from '@/lib/feature-flags'
import { getChannelOAuthToken } from '@/lib/youtube-channels'
import { YouTubeOAuthService } from '@/services/youtube'
import { recordUsage } from '@/lib/ai-usage'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_BYTES = 300 * 1024 * 1024

export async function POST(request: Request) {
  if (!youtubeUploadEnabled()) {
    return NextResponse.json({ error: 'YouTube Shorts publishing isn\'t enabled yet.' }, { status: 503 })
  }
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { videoUrl?: string; title?: string; description?: string; privacyStatus?: 'public' | 'unlisted' | 'private'; channelId?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const videoUrl = (body.videoUrl || '').trim()
  if (!/^https:\/\//i.test(videoUrl)) return NextResponse.json({ error: 'A video URL is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).single()
  const tier = normalizeTier(intRow?.tier) as Tier
  if (tier !== 'pro' && tier !== 'admin') {
    return NextResponse.json({ error: 'Publishing to YouTube is a Pro feature.', tierRequired: 'pro' }, { status: 403 })
  }

  const token = await getChannelOAuthToken(supabase, user.id, body.channelId ?? null)
  if (!token) {
    return NextResponse.json({ error: "YouTube isn't connected. Connect it first.", reconnectRequired: true }, { status: 412 })
  }

  // Pull the video bytes (the render lives on our storage / Cloudinary).
  let bytes: Uint8Array
  try {
    const res = await fetch(videoUrl)
    if (!res.ok) throw new Error(`fetch ${res.status}`)
    const len = Number(res.headers.get('content-length') || 0)
    if (len && len > MAX_BYTES) return NextResponse.json({ error: 'Video is over 300MB.' }, { status: 400 })
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: 'Video is over 300MB.' }, { status: 400 })
    bytes = new Uint8Array(buf)
  } catch (e) {
    return NextResponse.json({ error: `Couldn't read the video: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }

  const title = (body.title || '').trim().slice(0, 100) || 'New Short'
  // #Shorts in the description helps YouTube classify it as a Short.
  const description = `${(body.description || '').trim()}\n\n#Shorts`.trim().slice(0, 4900)

  try {
    const yt = new YouTubeOAuthService(token)
    const { id } = await yt.uploadShort(bytes, { title, description, privacyStatus: body.privacyStatus || 'public' })
    recordUsage({ userId: user.id, tier, feature: 'youtube_short_upload', model: 'youtube-data-api', images: 1 })
    return NextResponse.json({ ok: true, videoId: id, url: `https://youtube.com/shorts/${id}` })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'YouTube upload failed.'
    // 403 / insufficientPermissions → the stored token predates the upload scope.
    const reconnectRequired = /403|insufficient|insufficientPermissions|scope/i.test(msg)
    return NextResponse.json({
      error: reconnectRequired ? 'Reconnect YouTube to grant upload permission, then try again.' : msg,
      reconnectRequired,
    }, { status: reconnectRequired ? 412 : 502 })
  }
}
