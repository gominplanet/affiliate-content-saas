// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// POST /api/blog/resync-permalinks
//
// Re-fetches each published post's CURRENT permalink from WordPress and updates
// the stored blog_posts.wordpress_url to match. Fixes the case where a creator
// switched WordPress from "Plain" permalinks (?p=123) to "Post name" AFTER
// posts were generated: the stored URL stays ?p=123, so social re-shares and
// internal links keep using the ugly link. This pulls the clean permalink WP now
// reports and writes it back. Session-authed; per-site (multi-site aware).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data: posts } = await sb
      .from('blog_posts')
      .select('id, wordpress_post_id, wordpress_url, wordpress_site_id')
      .eq('user_id', user.id)
      .eq('status', 'published')
      .not('wordpress_post_id', 'is', null)
      .limit(5000)

    const rows = (posts ?? []) as Array<{ id: string; wordpress_post_id: number; wordpress_url: string | null; wordpress_site_id: string | null }>
    if (!rows.length) return NextResponse.json({ ok: true, checked: 0, updated: 0 })

    // Group by site so we hit each WP install once for its id→link map.
    const bySite = new Map<string | null, typeof rows>()
    for (const r of rows) {
      const key = r.wordpress_site_id ?? null
      const list = bySite.get(key) ?? []
      list.push(r)
      bySite.set(key, list)
    }

    let checked = 0
    let updated = 0
    for (const [siteId, siteRows] of bySite) {
      const creds = await getWordPressCredentials(supabase, user.id, siteId).catch(() => null)
      if (!creds?.wordpress_url || !creds.wordpress_username || !creds.wordpress_app_password) continue
      const wp = createWordPressService(creds.wordpress_url, creds.wordpress_username, creds.wordpress_app_password, creds.wordpress_api_token || undefined)
      let brief: Array<{ id: number; link: string }>
      try { brief = await wp.getPublishedPostsBrief() } catch { continue }
      const linkById = new Map<number, string>()
      for (const b of brief) if (b.link) linkById.set(b.id, b.link)

      for (const r of siteRows) {
        checked++
        const fresh = linkById.get(r.wordpress_post_id)
        // Only write when WP reports a real link that differs from what we stored.
        if (fresh && fresh !== r.wordpress_url) {
          const { error } = await sb.from('blog_posts').update({ wordpress_url: fresh }).eq('id', r.id)
          if (!error) updated++
        }
      }
    }

    return NextResponse.json({ ok: true, checked, updated })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Re-sync failed' }, { status: 500 })
  }
}
