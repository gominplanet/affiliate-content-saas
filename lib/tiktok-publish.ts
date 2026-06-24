// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Reusable TikTok Direct-Post core, callable with EITHER a cookie-scoped
// server client (the interactive routes) OR the service-role admin client (the
// scheduled-post cron). Works for BOTH targets MVP posts from:
//   • a blog post  → resolves the render via blog_posts, persists on blog_posts
//   • a Short      → resolves + persists directly on youtube_videos (no blog post)
// Mirrors app/api/blog/tiktok-post/route.ts + .../video/route.ts so the
// interactive and scheduled paths can't drift.

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

/** Exactly one of these identifies what to post. */
export interface PublishTarget {
  blogPostId?: string | null
  videoId?: string | null
}

/**
 * Direct-Post a vertical render to the creator's TikTok. Throws on any failure.
 * Returns the TikTok publish id and persists the initial state on the matching
 * row (blog_posts for a blog target, youtube_videos for a Short target).
 */
export async function publishTikTokForTarget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  userId: string,
  target: PublishTarget,
  caption: string,
  opts: TikTokScheduleOptions,
): Promise<{ publishId: string }> {
  if (!opts?.privacyLevel) throw new Error('Pick a privacy option before posting.')
  const blogPostId = target.blogPostId || null
  const videoId = target.videoId || null
  if (!blogPostId && !videoId) throw new Error('Nothing to post — no blog post or video given.')

  // Scope + token gates (tokens can change between scheduling and firing).
  const { data: integ } = await sb
    .from('integrations').select('tiktok_scopes').eq('user_id', userId).single()
  if (!scopesIncludePublish(integ?.tiktok_scopes)) {
    throw new Error("Your TikTok connection doesn't include the video.publish scope. Reconnect TikTok in Integrations.")
  }
  const token = await getValidTikTokToken(sb, userId)
  if (!token) throw new Error("TikTok isn't connected. Connect it in Integrations first.")

  // Daily cap (TikTok's documented 25/24h/account), counted on whichever table
  // this target persists to.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const capTable = videoId ? 'youtube_videos' : 'blog_posts'
  const { count } = await sb
    .from(capTable)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .not('tiktok_publish_id', 'is', null)
    .gte('tiktok_posted_at', since)
  if ((count ?? 0) >= POSTS_PER_24H) {
    throw new Error(`TikTok caps posting at ${POSTS_PER_24H} per 24 hours per account. Try again later.`)
  }

  // Resolve the shared 9:16 render.
  let storageUrl: string | undefined
  if (videoId) {
    const { data: v } = await sb
      .from('youtube_videos').select('instagram_video_url').eq('id', videoId).eq('user_id', userId).maybeSingle()
    if (!v) throw new Error('Video not found.')
    storageUrl = v.instagram_video_url as string | undefined
  } else {
    const { data: post } = await sb
      .from('blog_posts').select('youtube_videos(instagram_video_url)').eq('id', blogPostId).eq('user_id', userId).maybeSingle()
    if (!post) throw new Error('Post not found.')
    const yt = post.youtube_videos
    storageUrl = (Array.isArray(yt) ? yt[0] : yt)?.instagram_video_url as string | undefined
  }
  if (!storageUrl || !/^https:\/\//.test(storageUrl)) {
    throw new Error('No vertical video for this — add a 9:16 render before it can post.')
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

  const patch = {
    tiktok_publish_id: result.publishId,
    tiktok_publish_status: 'processing',
    tiktok_posted_at: new Date().toISOString(),
    tiktok_error_message: null,
    tiktok_share_url: null,
  }
  if (videoId) await sb.from('youtube_videos').update(patch).eq('id', videoId).eq('user_id', userId)
  else await sb.from('blog_posts').update(patch).eq('id', blogPostId).eq('user_id', userId)

  return { publishId: result.publishId }
}

/** Back-compat shim — older callers passed a bare blogPostId. */
export async function publishTikTokForBlogPost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any, userId: string, blogPostId: string, caption: string, opts: TikTokScheduleOptions,
): Promise<{ publishId: string }> {
  return publishTikTokForTarget(sb, userId, { blogPostId }, caption, opts)
}
