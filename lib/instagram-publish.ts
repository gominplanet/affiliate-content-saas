// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Reusable Instagram vertical (Reel/Story) publish core, callable with the
// cookie server client OR the service-role admin client (scheduled-post cron).
// Mirrors app/api/instagram/post-direct-video/route.ts.

import { publishMedia, refreshLongLivedToken } from '@/services/instagram'

export type IgMode = 'reel' | 'story' | 'both'

/**
 * Publish a video's shared 9:16 render to Instagram as a Reel and/or Story.
 * Resolves the video from the blog post's `video_id` so the scheduler can key
 * everything on blog_post_id. Throws Error if NOTHING published; returns the
 * created ids otherwise.
 */
export async function publishInstagramForBlogPost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  userId: string,
  blogPostId: string,
  caption: string,
  mode: IgMode = 'reel',
): Promise<{ reelId: string | null; storyId: string | null }> {
  const { data: integ } = await sb
    .from('integrations')
    .select('instagram_user_id,instagram_access_token,instagram_token_expiry')
    .eq('user_id', userId)
    .single()
  let accessToken = integ?.instagram_access_token as string | undefined
  const igUserId = integ?.instagram_user_id as string | undefined
  if (!accessToken || !igUserId) throw new Error("Instagram isn't connected. Connect it in Integrations first.")

  // Proactive refresh if the long-lived token expires within 24h.
  const expiry = Number(integ?.instagram_token_expiry || 0)
  if (expiry && Date.now() > expiry - 24 * 60 * 60 * 1000) {
    try {
      const refreshed = await refreshLongLivedToken(accessToken)
      accessToken = refreshed.accessToken
      await sb.from('integrations')
        .update({ instagram_access_token: accessToken, instagram_token_expiry: refreshed.expiresAt })
        .eq('user_id', userId)
    } catch { /* fall through with the existing token */ }
  }

  // Resolve the video + its 9:16 render from the blog post.
  const { data: post } = await sb
    .from('blog_posts')
    .select('video_id,youtube_videos(id,instagram_video_url)')
    .eq('id', blogPostId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!post) throw new Error('Post not found.')
  const yt = post.youtube_videos
  const ytRow = Array.isArray(yt) ? yt[0] : yt
  const videoDbId = (ytRow?.id as string | undefined) || (post.video_id as string | undefined)
  const videoUrl = ytRow?.instagram_video_url as string | undefined
  if (!videoUrl || !/^https:\/\//.test(videoUrl)) {
    throw new Error('No vertical MP4 for this post — add a 9:16 render before it can post.')
  }

  const cap = (caption || '').slice(0, 2200)
  const wantReel = mode === 'reel' || mode === 'both'
  const wantStory = mode === 'story' || mode === 'both'
  let reelId: string | null = null
  let storyId: string | null = null
  const errors: string[] = []

  if (wantReel) {
    try {
      reelId = await publishMedia({ userId: igUserId, accessToken: accessToken!, mediaType: 'REELS', videoUrl, caption: cap, shareToFeed: true })
    } catch (e) { errors.push(`Reel: ${e instanceof Error ? e.message : 'failed'}`) }
  }
  if (wantStory) {
    try {
      storyId = await publishMedia({ userId: igUserId, accessToken: accessToken!, mediaType: 'STORIES', videoUrl })
    } catch (e) { errors.push(`Story: ${e instanceof Error ? e.message : 'failed'}`) }
  }

  if (reelId || storyId) {
    const patch: Record<string, string | null> = { instagram_posted_at: new Date().toISOString() }
    if (reelId) patch.instagram_reel_id = reelId
    if (storyId) patch.instagram_story_id = storyId
    if (videoDbId) await sb.from('youtube_videos').update(patch).eq('id', videoDbId).eq('user_id', userId)
  }

  if (!reelId && !storyId) throw new Error(errors.join(' · ') || 'Instagram publish failed.')
  return { reelId, storyId }
}
