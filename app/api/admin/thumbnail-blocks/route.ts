/**
 * GET /api/admin/thumbnail-blocks — admin-only, READ-ONLY.
 *
 * Which sites have posts that published WITHOUT a featured thumbnail because the
 * host was rejecting WP media uploads (blog_posts.thumbnail_blocked, migration
 * 177). Grouped by user/site with a count, most-blocked first — so ops can spot
 * a site whose thumbnails are getting blocked and reach out before the user
 * even notices. Drift-safe: returns an empty list if the column isn't applied.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  let rows: Array<{ user_id: string }> = []
  try {
    const { data, error } = await admin
      .from('blog_posts')
      .select('user_id')
      .eq('thumbnail_blocked', true)
      .limit(5000)
    if (error) throw error
    rows = data || []
  } catch {
    // Column not applied yet (migration 177) — degrade gracefully.
    return NextResponse.json({ sites: [], total: 0, columnMissing: true })
  }

  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.user_id, (counts.get(r.user_id) || 0) + 1)
  const userIds = [...counts.keys()]

  const hosts = new Map<string, string>()
  if (userIds.length) {
    const { data: integs } = await admin
      .from('integrations').select('user_id, wordpress_url').in('user_id', userIds)
    for (const i of (integs || []) as Array<{ user_id: string; wordpress_url: string | null }>) {
      let h = i.wordpress_url || '(no site)'
      try { h = new URL(i.wordpress_url || '').host || h } catch { /* keep raw */ }
      hosts.set(i.user_id, h)
    }
  }

  const sites = userIds
    .map((uid) => ({ userId: uid, host: hosts.get(uid) || '(unknown)', blocked: counts.get(uid) || 0 }))
    .sort((a, b) => b.blocked - a.blocked)

  return NextResponse.json({ sites, total: rows.length })
}
