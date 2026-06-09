// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Per-site Geniuslink-group resolution.
//
// Why a per-site group matters: Geniuslink groups the user's account into
// buckets in the dashboard. When all of a user's MVP-generated links land
// in the same default "YouTube Links" bucket, a multi-site Pro user
// running gominreviews.com AND gominpetreviews.com can't tell which blog
// drove clicks. Routing each site's links to its own group fixes that.
//
// Resolution strategy (per WordPress site, per user):
//   1. wordpress_sites.geniuslink_group_id NOT NULL → use it (cached).
//   2. NULL → look up an existing group on the user's account whose name
//      matches the site's domain (case-insensitive exact match).
//   3. Still missing → auto-create a group named after the domain via the
//      Geniuslink API. Two endpoint shapes are tried (v1 form / v3 JSON)
//      because Geniuslink's docs aren't consistent across accounts.
//   4. Persist whatever we resolved back to wordpress_sites so step 1
//      handles every subsequent generation.
//   5. All-fallback failure → return null. Callers should fall back to
//      the service's default group + surface a soft warning so the user
//      can create the group manually on Geniuslink's side.
//
// Sibling of services/geniuslink/index.ts. The service exposes the raw
// API; this helper owns the DB cache + the per-site naming convention.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createGeniuslinkService } from '@/services/geniuslink'
import type { Database } from '@/lib/types/database'

type Client = SupabaseClient<Database>

/** The canonical group name for a site = its lowercased hostname (no
 *  protocol, no path, no trailing slash, no www). Matches what users
 *  typically name groups manually ("gominreviews.com"). */
export function groupNameForSiteUrl(siteUrl: string): string | null {
  try {
    const host = new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, '')
    return host || null
  } catch {
    return null
  }
}

interface ResolveOpts {
  supabase: Client
  /** WordPress site row id (PK on wordpress_sites). */
  siteId: string | null | undefined
  /** Site URL — only used to derive the group name when we need to
   *  resolve from scratch. */
  siteUrl: string | null | undefined
  /** Geniuslink credentials for the user. If missing, returns null
   *  (caller falls back to the no-Geniuslink path). */
  apiKey: string | null | undefined
  apiSecret: string | null | undefined
}

/**
 * Returns the Geniuslink group ID the user's links for this site should
 * land in, creating + caching it on first use. Returns null if anything
 * along the chain fails — the caller should fall back to the service's
 * default group (no behavior regression) and may optionally surface a
 * "couldn't auto-route to a per-site group" warning.
 */
export async function resolveGeniuslinkGroupId(opts: ResolveOpts): Promise<number | null> {
  const { supabase, siteId, siteUrl, apiKey, apiSecret } = opts
  if (!apiKey || !apiSecret) return null
  if (!siteId || !siteUrl) return null

  // Step 1 — cached value on the row.
  // Cast through unknown because the regenerated DB types lag behind the
  // migration (geniuslink_group_id was just added in migration 112).
  const { data: row } = await supabase
    .from('wordpress_sites')
    .select('geniuslink_group_id')
    .eq('id', siteId)
    .maybeSingle() as unknown as { data: { geniuslink_group_id: number | null } | null }
  if (row?.geniuslink_group_id) return row.geniuslink_group_id

  const groupName = groupNameForSiteUrl(siteUrl)
  if (!groupName) return null

  // Step 2 + 3 — find an existing match, then auto-create on miss.
  const svc = createGeniuslinkService(apiKey, apiSecret)
  let groupId: number | null = null
  try {
    groupId = await svc.getOrCreateGroupId(groupName)
  } catch (err) {
    console.error('[geniuslink-group] resolve failed:', err)
    return null
  }
  if (!groupId) return null

  // Step 4 — persist for next time. Don't fail the request if this write
  // hiccups; we'd just re-resolve on the next generation.
  await supabase
    .from('wordpress_sites')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ geniuslink_group_id: groupId } as any)
    .eq('id', siteId)
    .then(() => undefined, (err: unknown) => {
      console.error('[geniuslink-group] cache write failed:', err)
    })

  return groupId
}

/**
 * Append Amazon's per-click subID parameter (ascsubtag) to an Amazon
 * destination URL. The subtag rides through Geniuslink's redirect and
 * shows up in the Amazon Associates "Tracking ID Report" so the user can
 * see EARNINGS broken down per video / per post (vs Geniuslink's groups,
 * which give CLICK segmentation only).
 *
 * Returns the URL unchanged if:
 *   - Not an Amazon destination (subtag is Amazon-specific).
 *   - No subtag value provided.
 *   - URL already carries an ascsubtag (don't clobber a manual override).
 */
export function appendAmazonSubtag(url: string, subtag: string | null | undefined): string {
  if (!subtag) return url
  try {
    const u = new URL(url)
    if (!/(?:^|\.)amazon\.[a-z.]+$/i.test(u.hostname)) return url
    if (u.searchParams.has('ascsubtag')) return url
    // Amazon truncates ascsubtag at 16 chars (rolls up everything past
    // into a single bucket called "_other"). Clip pre-emptively so the
    // value the user sees in their report matches what we sent.
    u.searchParams.set('ascsubtag', String(subtag).slice(0, 16))
    return u.toString()
  } catch {
    return url
  }
}
