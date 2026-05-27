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
import { fetchLiveWpPostIds } from '@/lib/wp-live-posts'

export const maxDuration = 30

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url')
    .eq('user_id', user.id)
    .single()

  const wpUrl: string = (integ?.wordpress_url || '').replace(/\/$/, '')
  const ids = await fetchLiveWpPostIds(wpUrl)
  return NextResponse.json({ liveIds: ids ? Array.from(ids) : null })
}
