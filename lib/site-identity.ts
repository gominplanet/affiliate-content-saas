/**
 * Per-blog identity: give every connected WordPress site its OWN full identity
 * (brand name, tagline, colors, fonts, logo, banner, socials, About, ads, meta
 * tags, layout — everything), not one account-wide value shared by all blogs.
 *
 * HOW IT WORKS (the same pattern the blog switcher already uses for WP creds)
 * -------------------------------------------------------------------------
 * The whole app reads a blog's identity from two per-user tables:
 *   - brand_profiles           (name, tagline, colors, fonts, logo, socials…)
 *   - integrations.blog_customizations  (Customize Blog set)
 * Those two tables always hold the ACTIVE blog's identity. Each blog's full copy
 * is snapshotted onto its own wordpress_sites row. When the user switches blogs
 * in the topbar, we snapshot the outgoing blog and restore the incoming one, so
 * every reader (generation, sync, pages) transparently follows the active blog
 * without any of them needing to know about multi-site.
 *
 *   switch A → B:  snapshot A (brand_profiles + integrations → A's row)
 *                  restore B (B's row → brand_profiles + integrations)
 *
 * On every brand/customize save we also snapshot the active blog, so its row is
 * always current and a switch can never lose an edit.
 *
 * Single-site users never switch, so their brand_profiles/integrations stay put
 * and this is a no-op beyond a harmless snapshot on save.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'
import { getDefaultSite } from '@/lib/wordpress-sites'

type Client = SupabaseClient<Database>

// Columns on brand_profiles that identify the row itself — never copied into a
// snapshot (so a restore can't rewrite the owner or clobber timestamps).
const BRAND_ROW_KEYS = new Set(['id', 'user_id', 'created_at', 'updated_at'])

/** Snapshot the user's ACTIVE blog identity (brand_profiles +
 *  integrations.blog_customizations) onto that blog's own wordpress_sites row.
 *  Call after any brand or Customize save, and before switching away from a
 *  blog. Best-effort: never throws — a failure just leaves the row as it was. */
export async function snapshotActiveBlogIdentity(supabase: Client, userId: string): Promise<void> {
  try {
    const site = await getDefaultSite(supabase, userId)
    // 'legacy' = no real wordpress_sites row (single-site bridge). Nothing to
    // snapshot onto — the per-user tables ARE that user's only blog.
    if (!site || site.id === 'legacy') return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await (supabase as any)
      .from('brand_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brandSnapshot: Record<string, unknown> = {}
    if (brandRow && typeof brandRow === 'object') {
      for (const [k, v] of Object.entries(brandRow as Record<string, unknown>)) {
        if (!BRAND_ROW_KEYS.has(k)) brandSnapshot[k] = v
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('blog_customizations')
      .eq('user_id', userId)
      .maybeSingle()
    const blogCustomizations = intRow?.blog_customizations ?? null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, unknown> = {}
    if (Object.keys(brandSnapshot).length > 0) patch.brand_snapshot = brandSnapshot
    if (blogCustomizations != null) patch.blog_customizations = blogCustomizations
    if (Object.keys(patch).length === 0) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('wordpress_sites')
      .update(patch as never)
      .eq('user_id', userId)
      .eq('id', site.id)
  } catch { /* best-effort snapshot */ }
}

/** Restore a blog's saved identity from its wordpress_sites row into the live
 *  per-user tables (brand_profiles + integrations.blog_customizations), so the
 *  whole app now reflects that blog. Call right after switching the default site
 *  to `siteId`. If the blog has no snapshot yet (never customized on its own),
 *  the per-user tables are left as-is so it inherits the current identity as a
 *  starting point, then diverges on its first save. Best-effort. */
export async function restoreBlogIdentity(supabase: Client, userId: string, siteId: string): Promise<void> {
  try {
    if (!siteId || siteId === 'legacy') return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await (supabase as any)
      .from('wordpress_sites')
      .select('brand_snapshot, blog_customizations')
      .eq('user_id', userId)
      .eq('id', siteId)
      .maybeSingle()
    if (!row) return

    const brandSnapshot = row.brand_snapshot
    if (brandSnapshot && typeof brandSnapshot === 'object' && Object.keys(brandSnapshot).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('brand_profiles')
        .upsert({ ...(brandSnapshot as Record<string, unknown>), user_id: userId } as never, { onConflict: 'user_id' })
    }

    const bc = row.blog_customizations
    if (bc != null && typeof bc === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('integrations')
        .update({ blog_customizations: bc as never })
        .eq('user_id', userId)
    }
  } catch { /* best-effort restore */ }
}
