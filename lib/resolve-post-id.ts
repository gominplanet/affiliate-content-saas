import type { SupabaseClient } from '@supabase/supabase-js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Normalise a `postId` from a client to the `blog_posts` UUID.
 *
 * WHY: social-post routes look posts up with `.eq('id', postId)` (the
 * blog_posts UUID). Most callers send that UUID — but the Content page's
 * "Published Posts" rows for posts WITHOUT a source video (buying guides,
 * comparisons, link posts) carry only the WordPress post id, so they send the
 * numeric WP id instead. That made every social action on those rows fail with
 * "Post not found". This maps a numeric WP id to the owning blog_posts UUID
 * (user-scoped) so the downstream lookup resolves. Returns the input unchanged
 * when it's already a UUID, isn't numeric, or can't be mapped.
 */
export async function resolveBlogPostId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  postId: string | null | undefined,
): Promise<string | null | undefined> {
  if (!postId || UUID_RE.test(postId) || !/^\d+$/.test(postId)) return postId
  // Numeric → a WordPress post id. Find the owning blog_posts row.
  const { data } = await supabase
    .from('blog_posts')
    .select('id')
    .eq('user_id', userId)
    .eq('wordpress_post_id', Number(postId))
    .maybeSingle()
  return (data?.id as string) || postId
}
