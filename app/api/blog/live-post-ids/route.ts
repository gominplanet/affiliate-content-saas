/**
 * GET /api/blog/live-post-ids
 *
 * Returns the set of post IDs that ACTUALLY exist (published) on the user's
 * WordPress site, so the UI can reconcile its `blog_posts` catalog against
 * reality — a post deleted/trashed in WordPress still lingers in `blog_posts`
 * and would otherwise show as a phantom (404 link, source video stuck on
 * "published", etc.).
 *
 * Response: { liveIds: number[] | null }
 *   - number[]  → these WP post IDs are live; hide catalog rows not in this set
 *   - null      → couldn't read the site's REST API; caller shows everything
 *                 (a transient error must never hide real posts)
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'

export const maxDuration = 30

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token')
    .eq('user_id', user.id)
    .single()

  let ids: Set<number> | null = null
  if (integ?.wordpress_url && integ?.wordpress_username && integ?.wordpress_app_password) {
    try {
      const wpSvc = createWordPressService(integ.wordpress_url, integ.wordpress_username, integ.wordpress_app_password, integ.wordpress_api_token || undefined)
      ids = await wpSvc.getPublishedPostIds()
    } catch { ids = null }
  }
  return NextResponse.json({ liveIds: ids ? Array.from(ids) : null })
}
