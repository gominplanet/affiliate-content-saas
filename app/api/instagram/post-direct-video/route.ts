/**
 * POST /api/instagram/post-direct-video — direct vertical → IG flow.
 *
 * Body:
 *   videoId    uuid     — the youtube_videos row
 *   caption    string   — verbatim caption (≤2200 chars)
 *   mode       'reel' | 'story' | 'both'
 *
 * Posts to Instagram via the existing services/instagram.ts publishMedia
 * helper (REELS / STORIES media types). No blog post required — tracking
 * lands on youtube_videos.instagram_reel_id / instagram_story_id.
 *
 * Pro-gated. The Pro tier already includes IG in its `socials` array, so
 * tierAllowsSocial(tier, 'instagram') is the same gate the blog-post IG
 * route uses.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { publishMedia, refreshLongLivedToken } from '@/services/instagram'

export const maxDuration = 300

type Mode = 'reel' | 'story' | 'both'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { videoId?: string; caption?: string; mode?: Mode }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const videoId = (body.videoId || '').trim()
  const mode: Mode = body.mode === 'reel' || body.mode === 'story' || body.mode === 'both' ? body.mode : 'reel'
  if (!videoId) return NextResponse.json({ error: 'videoId is required.' }, { status: 400 })

  // ── Tier gate ────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: integ } = await sb
    .from('integrations')
    .select('tier,instagram_user_id,instagram_access_token,instagram_token_expiry')
    .eq('user_id', user.id)
    .single()
  const tier = (integ?.tier as Tier) ?? 'trial'
  if (!tierAllowsSocial(tier, 'instagram')) {
    return NextResponse.json({
      error: 'Instagram posting is a Pro feature.',
      tierRequired: 'pro',
    }, { status: 403 })
  }

  // ── Token check + refresh-if-stale ───────────────────────────────────────
  let accessToken = integ?.instagram_access_token as string | undefined
  const igUserId = integ?.instagram_user_id as string | undefined
  if (!accessToken || !igUserId) {
    return NextResponse.json({
      error: "Instagram isn't connected. Connect it in Integrations first.",
      reconnectRequired: true,
    }, { status: 412 })
  }
  const expiry = Number(integ?.instagram_token_expiry || 0)
  if (expiry && Date.now() > expiry - 24 * 60 * 60 * 1000) {
    // Token expires within 24h — refresh proactively (free for the user).
    try {
      const refreshed = await refreshLongLivedToken(accessToken)
      accessToken = refreshed.accessToken
      await sb
        .from('integrations')
        .update({ instagram_access_token: accessToken, instagram_token_expiry: refreshed.expiresAt })
        .eq('user_id', user.id)
    } catch { /* fall through with the existing token */ }
  }

  // ── Resolve the vertical video URL ───────────────────────────────────────
  const { data: video } = await sb
    .from('youtube_videos')
    .select('id,instagram_video_url')
    .eq('id', videoId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!video) return NextResponse.json({ error: 'Video not found.' }, { status: 404 })
  const videoUrl = video.instagram_video_url as string | undefined
  if (!videoUrl || !/^https:\/\//.test(videoUrl)) {
    return NextResponse.json({
      error: 'No vertical MP4 yet — upload one for this Short first.',
    }, { status: 400 })
  }

  const caption = (body.caption || '').slice(0, 2200)

  // ── Publish ──────────────────────────────────────────────────────────────
  const wantReel = mode === 'reel' || mode === 'both'
  const wantStory = mode === 'story' || mode === 'both'

  let reelId: string | null = null
  let storyId: string | null = null
  const errors: string[] = []

  if (wantReel) {
    try {
      reelId = await publishMedia({
        userId: igUserId,
        accessToken: accessToken!,
        mediaType: 'REELS',
        videoUrl,
        caption,
        shareToFeed: true,
      })
    } catch (e) {
      errors.push(`Reel: ${e instanceof Error ? e.message : 'failed'}`)
    }
  }
  if (wantStory) {
    try {
      storyId = await publishMedia({
        userId: igUserId,
        accessToken: accessToken!,
        mediaType: 'STORIES',
        videoUrl,
      })
    } catch (e) {
      errors.push(`Story: ${e instanceof Error ? e.message : 'failed'}`)
    }
  }

  // ── Persist whatever succeeded ───────────────────────────────────────────
  if (reelId || storyId) {
    const patch: Record<string, string | null> = { instagram_posted_at: new Date().toISOString() }
    if (reelId) patch.instagram_reel_id = reelId
    if (storyId) patch.instagram_story_id = storyId
    await sb
      .from('youtube_videos')
      .update(patch)
      .eq('id', videoId)
      .eq('user_id', user.id)
  }

  if (!reelId && !storyId) {
    return NextResponse.json({
      ok: false,
      error: errors.join(' · ') || 'Instagram publish failed.',
    }, { status: 502 })
  }

  return NextResponse.json({
    ok: true,
    reelId,
    storyId,
    partialErrors: errors.length ? errors : undefined,
  })
}
