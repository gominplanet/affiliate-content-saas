/**
 * POST /api/wordpress/merge-duplicate-categories
 *   Body: { siteId?: string, apply?: boolean }
 *
 * Cleans up categories that share the same display name on a creator's
 * WordPress site (e.g. two "Home & Kitchen" terms). For each duplicate group
 * it keeps the term with the most posts (tie → lowest id), reassigns every
 * post from the duplicates onto the keeper, then deletes the emptied terms.
 *
 * Runs in PREVIEW mode by default (apply=false) — returns exactly what WOULD
 * merge without changing anything. apply=true performs the merge. Posts are
 * never deleted; only redundant category terms are removed.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { toUserMessage } from '@/lib/friendly-error'

export const runtime = 'nodejs'
export const maxDuration = 120

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as { siteId?: string; apply?: boolean }
    const apply = body.apply === true

    const site = await getWordPressCredentials(supabase, user.id, body.siteId ?? null)
    if (!site) return NextResponse.json({ error: 'Connect your WordPress site first.' }, { status: 400 })

    const wp = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)

    const cats = await wp.listCategories()
    // Group by normalized name; skip the site's default "Uncategorized" bucket.
    const groups = new Map<string, typeof cats>()
    for (const c of cats) {
      if (norm(c.name) === 'uncategorized') continue
      const key = norm(c.name)
      const arr = groups.get(key) ?? []
      arr.push(c)
      groups.set(key, arr)
    }

    // Only groups with a genuine duplicate. Keeper = most posts, tie → lowest id.
    const dupGroups = [...groups.values()]
      .filter((g) => g.length > 1)
      .map((g) => {
        const sorted = [...g].sort((a, b) => (b.count - a.count) || (a.id - b.id))
        const keep = sorted[0]
        const remove = sorted.slice(1)
        return {
          name: keep.name,
          keep: { id: keep.id, count: keep.count },
          remove: remove.map((r) => ({ id: r.id, count: r.count })),
          totalPosts: remove.reduce((n, r) => n + r.count, 0),
        }
      })

    if (dupGroups.length === 0) {
      return NextResponse.json({ ok: true, mode: 'preview', site: site.site_label, groups: [], message: 'No duplicate categories found.' })
    }

    if (!apply) {
      return NextResponse.json({ ok: true, mode: 'preview', site: site.site_label, groups: dupGroups })
    }

    // Apply: reassign posts off each duplicate, then delete it.
    const merged: Array<{ name: string; keptId: number; movedPosts: number; deleted: number[] }> = []
    for (const g of dupGroups) {
      let moved = 0
      const deleted: number[] = []
      for (const dup of g.remove) {
        const postIds = await wp.getPostIdsInCategory(dup.id)
        for (const pid of postIds) {
          try {
            const current = await wp.getPostCategoryIds(pid)
            const next = [...new Set(current.map((c) => (c === dup.id ? g.keep.id : c)))]
            // Only write if it actually changes (avoids needless revisions).
            if (next.length !== current.length || next.some((c, i) => c !== current[i])) {
              await wp.updatePost(pid, { categories: next })
              moved++
            }
          } catch { /* skip this post; continue the merge */ }
        }
        try { await wp.deleteCategory(dup.id); deleted.push(dup.id) } catch { /* leave the term if delete fails */ }
      }
      merged.push({ name: g.name, keptId: g.keep.id, movedPosts: moved, deleted })
    }

    // Refresh the theme's cached post counts if that endpoint exists (best-effort).
    try { await wp.purgeCache() } catch { /* non-fatal */ }

    return NextResponse.json({
      ok: true,
      mode: 'applied',
      site: site.site_label,
      merged,
      groupsMerged: merged.length,
      categoriesRemoved: merged.reduce((n, m) => n + m.deleted.length, 0),
      postsReassigned: merged.reduce((n, m) => n + m.movedPosts, 0),
    })
  } catch (err) {
    console.error('[merge-duplicate-categories]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Couldn’t clean up categories just now. Please try again in a moment.') }, { status: 500 })
  }
}
