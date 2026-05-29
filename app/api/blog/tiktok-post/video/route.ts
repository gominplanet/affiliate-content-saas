/**
 * POST /api/blog/tiktok-post/video — Direct Post a vertical YT short to
 * TikTok with NO blog post involved.
 *
 * Mirrors /api/blog/tiktok-post (blog-post variant) but reads from
 * youtube_videos and persists publish state there instead of on
 * blog_posts. Same scopes, same Pro gate, same 25/24h TikTok-documented
 * cap (counted across both video-direct AND blog-post posts so a creator
 * can't double the cap by using both surfaces).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import {
  getValidTikTokToken,
  directPostVideo,
  scopesIncludePublish,
  type DirectPostOptions,
} from '@/services/tiktok'

const POSTS_PER_24H = 25

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    videoId?: string
    caption?: string
    privacyLevel?: DirectPostOptions['privacyLevel']
    disableComment?: boolean
    disableDuet?: boolean
    disableStitch?: boolean
    brandContentToggle?: boolean
    brandOrganicToggle?: boolean
  }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const videoId = (body.videoId || '').trim()
  if (!videoId) return NextResponse.json({ error: 'videoId is required.' }, { status: 400 })
  if (!body.privacyLevel) return NextResponse.json({ error: 'Pick a privacy option before posting.' }, { status: 400 })

  // ── 1. Tier gate ──────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: integ } = await sb
    .from('integrations')
    .select('tier,tiktok_scopes')
    .eq('user_id', user.id)
    .single()
  const tier = (integ?.tier as Tier) ?? 'trial'
  if (!tierAllowsSocial(tier, 'tiktok')) {
    return NextResponse.json({
      error: 'TikTok posting is a Pro feature.',
      tierRequired: 'pro',
    }, { status: 403 })
  }

  // ── 2. Scope gate ────────────────────────────────────────────────────────
  if (!scopesIncludePublish(integ?.tiktok_scopes)) {
    return NextResponse.json({
      error: "Your TikTok connection doesn't include the video.publish scope. Disconnect and reconnect TikTok in Integrations to grant it.",
      reconnectRequired: true,
    }, { status: 412 })
  }

  // ── 3. Token gate ────────────────────────────────────────────────────────
  const token = await getValidTikTokToken(supabase, user.id)
  if (!token) {
    return NextResponse.json({
      error: "TikTok isn't connected. Connect it in Integrations first.",
      reconnectRequired: true,
    }, { status: 412 })
  }

  // ── 4. Daily cap (combined across blog_posts AND youtube_videos) ─────────
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const [{ count: blogCount }, { count: videoCount }] = await Promise.all([
    sb.from('blog_posts').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .not('tiktok_publish_id', 'is', null)
      .gte('tiktok_posted_at', since),
    sb.from('youtube_videos').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .not('tiktok_publish_id', 'is', null)
      .gte('tiktok_posted_at', since),
  ])
  const totalRecent = (blogCount ?? 0) + (videoCount ?? 0)
  if (totalRecent >= POSTS_PER_24H) {
    return NextResponse.json({
      error: `TikTok caps posting at ${POSTS_PER_24H} per 24 hours per account. Try again later.`,
      limitReached: true,
    }, { status: 429 })
  }

  // ── 5. Resolve the vertical video URL ─────────────────────────────────────
  // TikTok's Content Posting API rejects PULL_FROM_URL whenever the source
  // domain isn't verified under their Domain Verification settings. We
  // only verified mvpaffiliate.io, so we hand TikTok a URL on OUR domain
  // (the proxy route below) instead of the raw Supabase Storage URL.
  // The proxy server-side streams the bytes from Supabase.
  const { data: video } = await sb
    .from('youtube_videos')
    .select('id,instagram_video_url')
    .eq('id', videoId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!video) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })
  const storageUrl = video.instagram_video_url as string | undefined
  if (!storageUrl || !/^https:\/\//.test(storageUrl)) {
    return NextResponse.json({
      error: 'No vertical video file for this Short yet. Upload the MP4 first.',
    }, { status: 400 })
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const videoUrl = `${appUrl.replace(/\/$/, '')}/api/proxy-short/${videoId}`

  // ── 6. Direct Post ───────────────────────────────────────────────────────
  const caption = (body.caption || '').slice(0, 2200)
  let publishId: string
  try {
    const result = await directPostVideo(token, {
      title: caption,
      privacyLevel: body.privacyLevel,
      disableComment: !!body.disableComment,
      disableDuet: !!body.disableDuet,
      disableStitch: !!body.disableStitch,
      brandContentToggle: !!body.brandContentToggle,
      brandOrganicToggle: !!body.brandOrganicToggle,
      videoUrl,
    })
    publishId = result.publishId
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'TikTok publish failed.'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // ── 7. Persist state on youtube_videos ────────────────────────────────────
  await sb
    .from('youtube_videos')
    .update({
      tiktok_publish_id: publishId,
      tiktok_publish_status: 'processing',
      tiktok_posted_at: new Date().toISOString(),
      tiktok_error_message: null,
      tiktok_share_url: null,
    })
    .eq('id', videoId)
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true, publishId })
}
