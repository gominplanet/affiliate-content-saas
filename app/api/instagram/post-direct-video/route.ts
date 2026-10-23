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
import { trackPost } from '@/lib/reach-pulse'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getPublishContext } from '@/lib/agency-publish'
import { maybeDecrypt } from '@/lib/secrets'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { publishMedia, refreshLongLivedToken, subscribeToComments } from '@/services/instagram'
import { attachReelAutoDm } from '@/lib/ig-dm'
import { addPostedProductToBio } from '@/lib/link-bio-import'
import { fitHashtags } from '@/lib/hashtag-engine'

export const maxDuration = 300

type Mode = 'reel' | 'story' | 'both'

export async function POST(request: Request) {
  // A Virtual Assistant publishes through the owner's accounts (lib/agency-publish).
  const pub = await getPublishContext(await createServerClient())
  if ('error' in pub) return pub.error
  const { supabase, user } = pub

  // autoDm: commenting `keyword` on the Reel DMs `link` (lib/ig-dm), as the
  // TikTok window's "Also post to Instagram" offers it.
  let body: { videoId?: string; caption?: string; mode?: Mode; autoDm?: { link?: string; keyword?: string; productName?: string } }
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
  let accessToken = maybeDecrypt(integ?.instagram_access_token) as string | undefined
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
        .update(encryptIntegrationWrite({ instagram_access_token: accessToken, instagram_token_expiry: refreshed.expiresAt }))
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

  // The hashtag safety net (lib/hashtag-engine): each tag once, no spam or
  // years, and no more than Instagram takes with #ad counted.
  const caption = fitHashtags((body.caption || '').slice(0, 2200), 'instagram')

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
    // If the creator opted in, drop this product onto their Link in Bio shop page
    // automatically. Best-effort — never let a bio-import hiccup fail the publish.
    // Always when the caption says "link in bio".
    await addPostedProductToBio(sb, user.id, videoId, { caption })
  }

  if (!reelId && !storyId) {
    return NextResponse.json({
      ok: false,
      error: errors.join(' · ') || 'Instagram publish failed.',
    }, { status: 502 })
  }

  // The Reel's own Auto-DM, reported as it went (never assumed).
  let autoDm = false
  let autoDmError: string | null = null
  let autoDmKeyword: string | null = null
  if (body.autoDm) {
    const att = await attachReelAutoDm(sb, {
      userId: user.id, mediaId: reelId, keyword: body.autoDm.keyword, link: body.autoDm.link,
      productName: body.autoDm.productName, caption, videoUrl,
    })
    if (att.ok) {
      autoDm = true
      autoDmKeyword = att.keyword
      // Make sure this account receives comment webhooks (idempotent).
      try { await subscribeToComments({ igUserId, accessToken: accessToken! }) } catch { /* non-fatal */ }
    } else autoDmError = reelId ? att.error : 'Only a Reel takes Auto-DM, and no Reel was posted.'
  }

  // PULSE ON EVERY PLATFORM (lib/reach-pulse trackPost): the Reel's tags.
  if (reelId) await trackPost({ userId: user.id, platform: 'instagram', postId: reelId, caption })
  return NextResponse.json({
    ok: true,
    reelId,
    storyId,
    autoDm,
    autoDmError,
    autoDmKeyword,
    partialErrors: errors.length ? errors : undefined,
  })
}
