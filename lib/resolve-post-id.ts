import type { SupabaseClient } from '@supabase/supabase-js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const normUrl = (u: string | null | undefined) => (u || '').trim().replace(/\/+$/, '').toLowerCase()

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
 *
 * `fallbackUrl` (the post's WordPress permalink) is a SECOND resolution path:
 * the `wordpress_url` survives a rebuild that mints a new WP post id, whereas a
 * stale/missing `wordpress_post_id` orphans the row. When the id path can't map
 * (numeric id with no matching row), we try matching `wordpress_url` so social
 * actions still resolve. Mirrors the dual (id-then-url) match the Content page
 * already does client-side to compute `mvpId`.
 */
export async function resolveBlogPostId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  postId: string | null | undefined,
  fallbackUrl?: string | null,
): Promise<string | null | undefined> {
  // Already a UUID → trust it (the common case). No lookup needed.
  if (postId && UUID_RE.test(postId)) return postId

  // Numeric → a WordPress post id. Find the owning blog_posts row by WP id.
  if (postId && /^\d+$/.test(postId)) {
    const { data } = await supabase
      .from('blog_posts')
      .select('id')
      .eq('user_id', userId)
      .eq('wordpress_post_id', Number(postId))
      .maybeSingle()
    if (data?.id) return data.id as string
    // Fall through to the URL match — the WP id may have drifted on a rebuild.
  }

  // Last resort: match by the post's WordPress permalink. Rescues rows whose
  // wordpress_post_id is missing/stale but whose URL is stored. Normalised
  // compare (trailing slash + case) since WP and our stored URL can differ.
  const u = normUrl(fallbackUrl)
  if (u) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows } = await (supabase as any)
      .from('blog_posts')
      .select('id,wordpress_url')
      .eq('user_id', userId)
      .limit(2000)
    const hit = (rows as Array<{ id: string; wordpress_url: string | null }> | null)
      ?.find(r => normUrl(r.wordpress_url) === u)
    if (hit?.id) return hit.id as string
  }

  return postId
}
