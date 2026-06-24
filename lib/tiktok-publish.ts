// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Reusable TikTok Direct-Post core, callable with EITHER a cookie-scoped
// server client (the interactive route) OR the service-role admin client (the
// scheduled-post cron). Mirrors app/api/blog/tiktok-post/route.ts so the two
// paths can't drift on what a correct publish looks like.

import {
  getValidTikTokToken,
  directPostVideoUpload,
  scopesIncludePublish,
  type DirectPostOptions,
} from '@/services/tiktok'

const POSTS_PER_24H = 25

export interface TikTokScheduleOptions {
  privacyLevel: DirectPostOptions['privacyLevel']
  disableComment?: boolean
  disableDuet?: boolean
  disableStitch?: boolean
  brandContentToggle?: boolean
  brandOrganicToggle?: boolean
}

/**
 * Direct-Post a post's vertical render to the creator's TikTok. Throws Error on
 * any failure (the caller maps it to a 502 / a failed scheduled row). Returns
 * the TikTok publish id on success and persists the initial state on blog_posts.
 *
 * `sb` may be the cookie server client or the admin client — both expose the
 * same query surface, and getValidTikTokToken refreshes against whichever.
 */
export async function publishTikTokForBlogPost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  userId: string,
  blogPostId: string,
  caption: string,
  opts: TikTokScheduleOptions,
): Promise<{ publishId: string }> {
  if (!opts?.privacyLevel) throw new Error('Pick a privacy option before posting.')

  // Scope + token gates (tokens can change between scheduling and firing).
  const { data: integ } = await sb
    .from('integrations').select('tiktok_scopes').eq('user_id', userId).single()
  if (!scopesIncludePublish(integ?.tiktok_scopes)) {
    throw new Error("Your TikTok connection doesn't include the video.publish scope. Reconnect TikTok in Integrations.")
  }
  const token = await getValidTikTokToken(sb, userId)
  if (!token) throw new Error("TikTok isn't connected. Connect it in Integrations first.")

  // Daily cap (TikTok's documented 25/24h/account).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await sb
    .from('blog_posts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .not('tiktok_publish_id', 'is', null)
    .gte('tiktok_posted_at', since)
  if ((count ?? 0) >= POSTS_PER_24H) {
    throw new Error(`TikTok caps posting at ${POSTS_PER_24H} per 24 hours per account. Try again later.`)
  }

  // Resolve the shared 9:16 render.
  const { data: post } = await sb
    .from('blog_posts')
    .select('id,user_id,video_id,youtube_videos(instagram_video_url)')
    .eq('id', blogPostId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!post) throw new Error('Post not found.')
  const yt = post.youtube_videos
  const ytRow = Array.isArray(yt) ? yt[0] : yt
  const storageUrl = ytRow?.instagram_video_url as string | undefined
  if (!storageUrl || !/^https:\/\//.test(storageUrl)) {
    throw new Error('No vertical video for this post — add a 9:16 render before it can post.')
  }

  const result = await directPostVideoUpload(token, {
    title: (caption || '').slice(0, 2200),
    privacyLevel: opts.privacyLevel,
    disableComment: !!opts.disableComment,
    disableDuet: !!opts.disableDuet,
    disableStitch: !!opts.disableStitch,
    brandContentToggle: !!opts.brandContentToggle,
    brandOrganicToggle: !!opts.brandOrganicToggle,
    upstreamUrl: storageUrl,
  })

  await sb
    .from('blog_posts')
    .update({
      tiktok_publish_id: result.publishId,
      tiktok_publish_status: 'processing',
      tiktok_posted_at: new Date().toISOString(),
      tiktok_error_message: null,
      tiktok_share_url: null,
    })
    .eq('id', blogPostId)
    .eq('user_id', userId)

  return { publishId: result.publishId }
}
