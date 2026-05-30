/**
 * POST /api/blog/tiktok-post — Direct Post a video to the creator's TikTok.
 *
 * Inputs (JSON):
 *   blogPostId        string  — the MVP blog_posts row whose vertical render is being posted
 *   caption           string  — verbatim caption text (max 2200 chars)
 *   privacyLevel      string  — one of the values returned by creator_info/query
 *   disableComment    boolean
 *   disableDuet       boolean
 *   disableStitch     boolean
 *   brandContentToggle boolean
 *   brandOrganicToggle boolean
 *
 * Returns:
 *   { ok: true, publishId } on success
 *   { error, reconnectRequired? } on failure
 *
 * Tier-gated (Pro+), token-gated (TikTok connected + video.publish scope),
 * cap-gated (TikTok's documented 25 posts / 24h / account).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import {
  getValidTikTokToken,
  directPostVideoUpload,
  scopesIncludePublish,
  type DirectPostOptions,
} from '@/services/tiktok'

const POSTS_PER_24H = 25

// FILE_UPLOAD path: we download the video from Supabase server-side, then
// upload it to TikTok in the same request. Bump the Vercel ceiling so we
// have headroom for 100MB+ videos on slow upstreams.
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    blogPostId?: string
    caption?: string
    privacyLevel?: DirectPostOptions['privacyLevel']
    disableComment?: boolean
    disableDuet?: boolean
    disableStitch?: boolean
    brandContentToggle?: boolean
    brandOrganicToggle?: boolean
  }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const blogPostId = (body.blogPostId || '').trim()
  if (!blogPostId) return NextResponse.json({ error: 'blogPostId is required.' }, { status: 400 })
  if (!body.privacyLevel) return NextResponse.json({ error: 'Pick a privacy option before posting.' }, { status: 400 })

  // ── 1. Tier gate ──────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: integ } = await sb
    .from('integrations')
    .select('tier,tiktok_scopes,tiktok_username')
    .eq('user_id', user.id)
    .single()
  const tier = (integ?.tier as Tier) ?? 'trial'
  if (!tierAllowsSocial(tier, 'tiktok')) {
    return NextResponse.json({
      error: 'TikTok posting is a Pro feature.',
      tierRequired: 'pro',
    }, { status: 403 })
  }

  // ── 2. Scope gate (fail fast w/o burning a TikTok API call) ──────────────
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
      error: 'TikTok isn\'t connected. Connect it in Integrations first.',
      reconnectRequired: true,
    }, { status: 412 })
  }

  // ── 4. Daily cap (TikTok's documented 25/24h/account) ────────────────────
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await sb
    .from('blog_posts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .not('tiktok_publish_id', 'is', null)
    .gte('tiktok_posted_at', since)
  if ((count ?? 0) >= POSTS_PER_24H) {
    return NextResponse.json({
      error: `TikTok caps posting at ${POSTS_PER_24H} per 24 hours per account. Try again later.`,
      limitReached: true,
    }, { status: 429 })
  }

  // ── 5. Resolve the rendered vertical video URL ───────────────────────────
  // For V1 we reuse the same vertical render path Instagram uses
  // (youtube_videos.instagram_video_url). The watermark audit confirmed
  // this render is clean — no MVP logo, no superimposed text — so it
  // satisfies TikTok's content-sharing guidelines.
  const { data: post } = await sb
    .from('blog_posts')
    .select('id,user_id,title,video_id,youtube_videos(instagram_video_url,youtube_video_id)')
    .eq('id', blogPostId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!post) return NextResponse.json({ error: 'Post not found.' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yt = (post as any).youtube_videos
  const ytRow = Array.isArray(yt) ? yt[0] : yt
  const storageUrl = ytRow?.instagram_video_url as string | undefined
  const ytVideoId = ytRow?.youtube_video_id as string | undefined
  if (!storageUrl || !/^https:\/\//.test(storageUrl)) {
    return NextResponse.json({
      error: 'No vertical video file for this post yet. Upload one in the Instagram pane first — TikTok and Instagram share the same 9:16 render.',
    }, { status: 400 })
  }
  // FILE_UPLOAD path: push video bytes directly to TikTok's one-time
  // upload_url instead of having them pull from us. PULL_FROM_URL was
  // silently pre-rejecting with `video_pull_failed` even with our
  // verified domain — see /api/blog/tiktok-post/video/route.ts for the
  // full diagnostic that proved this. FILE_UPLOAD has no URL surface,
  // so the entire failure class goes away.
  void ytVideoId
  const blogPostVideoUuid = (post as { video_id?: string }).video_id
  if (!blogPostVideoUuid) {
    return NextResponse.json({
      error: 'This post is missing a linked YouTube video — can\'t resolve the vertical URL.',
    }, { status: 400 })
  }
  // eslint-disable-next-line no-console
  console.log(`[tiktok-publish] upstreamUrl=${storageUrl} privacy=${body.privacyLevel} brandContent=${!!body.brandContentToggle} brandOrganic=${!!body.brandOrganicToggle}`)

  // ── 6. Direct Post (FILE_UPLOAD) ────────────────────────────────────────
  const caption = (body.caption || '').slice(0, 2200)
  let publishId: string
  try {
    const result = await directPostVideoUpload(token, {
      title: caption,
      privacyLevel: body.privacyLevel,
      disableComment: !!body.disableComment,
      disableDuet: !!body.disableDuet,
      disableStitch: !!body.disableStitch,
      brandContentToggle: !!body.brandContentToggle,
      brandOrganicToggle: !!body.brandOrganicToggle,
      upstreamUrl: storageUrl,
    })
    publishId = result.publishId
    // eslint-disable-next-line no-console
    console.log(`[tiktok-publish] publishId=${publishId} blogPostId=${blogPostId}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'TikTok publish failed.'
    // eslint-disable-next-line no-console
    console.log(`[tiktok-publish] upload FAILED blogPostId=${blogPostId} err=${msg}`)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // ── 7. Persist initial state ─────────────────────────────────────────────
  await sb
    .from('blog_posts')
    .update({
      tiktok_publish_id: publishId,
      tiktok_publish_status: 'processing',
      tiktok_posted_at: new Date().toISOString(),
      tiktok_error_message: null,
      tiktok_share_url: null,
    })
    .eq('id', blogPostId)
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true, publishId })
}
