/**
 * POST /api/campaigns/clear
 *
 * Clears the EPC Scout queue backlog — the scouted-but-un-actioned campaigns
 * that pile up after repeated extension pushes. Deletes ONLY rows that are:
 *   - un-actioned (status pending / ready / new / failed), AND
 *   - not tied to a published post (blog_post_id + wordpress_url both null), AND
 *   - not owned by an in-flight job (queued / researching / generating are left
 *     alone so a running generation isn't yanked out from under it).
 *
 * Published/posted campaigns are NEVER touched here (they're real WordPress
 * posts — remove those one at a time so the WP post is deleted too). Uses the
 * service-role client (scoped by user_id) because `campaigns` has no DELETE
 * RLS policy — same reason as /api/campaigns/delete.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const CLEARABLE = ['pending', 'ready', 'new', 'failed']

export async function POST() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error } = await (admin as any)
      .from('campaigns')
      .delete({ count: 'exact' })
      .eq('user_id', user.id)
      .in('status', CLEARABLE)
      .is('blog_post_id', null)
      .is('wordpress_url', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, deleted: count ?? 0 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
