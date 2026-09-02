/**
 * POST /api/youtube/upload-video — publish a full (horizontal) video to the
 * creator's YouTube channel. This is the "MVP as origin" publish step: the
 * creator uploads a file into MVP, we burn the CTA, and this pushes the finished
 * cut straight to their channel. Same OAuth + scope rules as upload-short, minus
 * the #Shorts classification.
 *
 * Body: { videoUrl, title, description?, tags?, privacyStatus?, channelId? }
 * Returns: { ok, videoId, url } | { error, reconnectRequired?, notEnabled? }
 *
 * Pro-only. Gated on the youtube.upload scope (reconnectRequired) and the
 * feature flag (notEnabled) until Google verifies the scope.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { getChannelOAuthToken } from '@/lib/youtube-channels'
import { YouTubeOAuthService } from '@/services/youtube'
import { youtubeUploadEnabled } from '@/lib/feature-flags'
import { recordUsage } from '@/lib/ai-usage'
import { recordReachSample } from '@/lib/reach-pulse'

export const runtime = 'nodejs'
export const maxDuration = 300

// Matches the Launchpad UI upload cap + the Supabase bucket per-file limit (500MB).
const MAX_BYTES = 500 * 1024 * 1024

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { videoUrl?: string; title?: string; description?: string; tags?: string[]; privacyStatus?: 'public' | 'unlisted' | 'private'; channelId?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const videoUrl = (body.videoUrl || '').trim()
  if (!/^https:\/\//i.test(videoUrl)) return NextResponse.json({ error: 'A video URL is required.' }, { status: 400 })
  const title = (body.title || '').trim().slice(0, 100)
  if (!title) return NextResponse.json({ error: 'A title is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).single()
  const tier = normalizeTier(intRow?.tier) as Tier
  if (tier !== 'pro' && tier !== 'admin') {
    return NextResponse.json({ error: 'Publishing to YouTube is a Pro feature.', tierRequired: 'pro' }, { status: 403 })
  }
  // Dark to the public until Google verifies the youtube.upload scope. Admins
  // pass so we can dogfood + record the verification demo.
  if (!youtubeUploadEnabled({ tier })) {
    return NextResponse.json({ error: "Publishing to YouTube isn't available yet — it's coming soon.", notEnabled: true }, { status: 403 })
  }

  const token = await getChannelOAuthToken(supabase, user.id, body.channelId ?? null)
  if (!token) {
    return NextResponse.json({ error: "YouTube isn't connected. Connect it first.", reconnectRequired: true }, { status: 412 })
  }

  // Pull the rendered video bytes (the CTA render lives on our storage).
  let bytes: Uint8Array
  try {
    const res = await fetch(videoUrl)
    if (!res.ok) throw new Error(`fetch ${res.status}`)
    const len = Number(res.headers.get('content-length') || 0)
    if (len && len > MAX_BYTES) return NextResponse.json({ error: 'Video is over 500MB.' }, { status: 400 })
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: 'Video is over 500MB.' }, { status: 400 })
    bytes = new Uint8Array(buf)
  } catch (e) {
    return NextResponse.json({ error: `Couldn't read the video: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }

  const description = (body.description || '').trim().slice(0, 4900)
  const tags = Array.isArray(body.tags) ? body.tags.map(t => String(t)).filter(Boolean).slice(0, 15) : []

  try {
    const yt = new YouTubeOAuthService(token)
    // uploadShort is a generic resumable video upload; the only "Short" part is
    // the caller's metadata, so it publishes a full horizontal video just as well.
    const { id } = await yt.uploadShort(bytes, { title, description, tags, privacyStatus: body.privacyStatus || 'public' })
    recordUsage({ userId: user.id, tier, feature: 'youtube_video_upload', model: 'youtube-data-api', images: 1 })
    void recordReachSample({
      userId: user.id, platform: 'youtube', mediaId: id,
      caption: description,
      hashtags: tags.map(t => (t.startsWith('#') ? t : `#${t}`)),
      productText: title,
    }).catch(() => {})
    return NextResponse.json({ ok: true, videoId: id, url: `https://youtube.com/watch?v=${id}` })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'YouTube upload failed.'
    const reconnectRequired = /403|insufficient|insufficientPermissions|scope/i.test(msg)
    return NextResponse.json({
      error: reconnectRequired ? 'Reconnect YouTube to grant upload permission, then try again.' : msg,
      reconnectRequired,
    }, { status: reconnectRequired ? 412 : 502 })
  }
}
