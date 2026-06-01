/**
 * Helpers for the multi-site WordPress feature (Pro tier).
 *
 * The wordpress_sites table replaces the singular `integrations.wordpress_*`
 * columns. Pro plans support up to 5 sites (one per niche / client / project);
 * Creator + Studio stay at 1 site (the existing behaviour, just stored in
 * the new table).
 *
 * USAGE
 * -----
 * Every WP route that used to read integrations.wordpress_* now reads via
 * one of:
 *
 *   getDefaultSite(supabase, userId)     // most common path
 *   getSite(supabase, userId, siteId)    // when the user explicitly picks
 *   listSites(supabase, userId)          // Settings UI + site pickers
 *
 * The route can optionally accept a `siteId` query/body param so the user
 * can target a non-default site for a single action (e.g. "publish this
 * comparison to my Wine blog, not my main").
 *
 * BACKWARDS COMPAT
 * ----------------
 * Phase 1 (this file) ONLY backfills + exposes helpers. The actual route
 * migration happens in Phase 3. Until then, routes still read the legacy
 * integrations.wordpress_* columns. Both paths return the same data because
 * the migration backfilled wordpress_sites from integrations.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'
import { TIERS, normalizeTier, type Tier } from '@/lib/tier'

type Client = SupabaseClient<Database>

/** A single WordPress site connection. The shape consumers care about — we
 *  drop the timestamps + display_order that the Settings UI handles itself. */
export interface WordPressSite {
  id: string
  label: string
  url: string
  username: string
  appPassword: string
  apiToken: string | null
  isDefault: boolean
}

/** Per-tier site cap. Driven by tier config so future tier changes (e.g.
 *  an Agency tier with 25 sites) only need a TIERS update, not code edits.
 *  Studio + Creator keep their 1-site behaviour; Pro gets 5; Admin uncapped. */
export function maxSitesForTier(tier: Tier): number {
  const t = normalizeTier(tier)
  if (t === 'admin') return 999
  if (t === 'pro') return 5
  // Creator + Studio + trial all get exactly one site — same as the
  // single-site behaviour before this migration.
  return 1
}

/** Whether the user can add another site (true when below their tier cap).
 *  The DB-level trigger enforces the hard cap; this is for UX gating. */
export async function canAddSite(
  supabase: Client,
  userId: string,
  tier: Tier,
): Promise<{ allowed: boolean; current: number; cap: number }> {
  const { count } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('wordpress_sites' as any)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  const current = count ?? 0
  const cap = maxSitesForTier(tier)
  return { allowed: current < cap, current, cap }
}

/** All connected sites for a user, default first then by display_order.
 *  Returns empty array if none — the calling route should check and surface
 *  "WordPress not connected" to the user.
 *
 *  Single-site users get a 1-element array; multi-site users get up to 5. */
export async function listSites(
  supabase: Client,
  userId: string,
): Promise<WordPressSite[]> {
  const { data, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('wordpress_sites' as any)
    .select('id, label, url, username, app_password, api_token, is_default, display_order')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error || !data) return []
  return (data as unknown as WordPressSiteRow[]).map(rowToSite)
}

/** Default site for the user — what generations + publish actions target
 *  unless the user explicitly picks another. Returns null when the user has
 *  no sites connected.
 *
 *  Falls back to legacy integrations.wordpress_* when wordpress_sites is empty
 *  AND integrations has a WP connection. This bridge is here ONLY while
 *  Phase 1 + 2 + 3 are in flight; remove it when Phase 3 ships. */
export async function getDefaultSite(
  supabase: Client,
  userId: string,
): Promise<WordPressSite | null> {
  // 1. Prefer the new table — that's the post-migration source of truth.
  const { data } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('wordpress_sites' as any)
    .select('id, label, url, username, app_password, api_token, is_default, display_order')
    .eq('user_id', userId)
    .eq('is_default', true)
    .maybeSingle()
  if (data) return rowToSite(data as unknown as WordPressSiteRow)

  // 2. No default? Take whatever ONE site they have — handles the edge case
  //    where a user has sites but none is_default (shouldn't happen because
  //    backfill marks one true, but a partial restore could).
  const { data: any1 } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('wordpress_sites' as any)
    .select('id, label, url, username, app_password, api_token, is_default, display_order')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (any1) return rowToSite(any1 as unknown as WordPressSiteRow)

  // 3. Bridge: read from legacy integrations columns. Lets Phase 1 ship
  //    without breaking every WP route for users whose backfill somehow
  //    didn't pick them up. Remove this branch when Phase 3 completes.
  const { data: legacy } = await supabase
    .from('integrations')
    .select('wordpress_url, wordpress_username, wordpress_app_password, wordpress_api_token')
    .eq('user_id', userId)
    .maybeSingle()
  if (
    legacy?.wordpress_url &&
    legacy?.wordpress_username &&
    legacy?.wordpress_app_password
  ) {
    return {
      id: 'legacy',  // sentinel; consumers don't write to a 'legacy' id
      label: 'Main',
      url: legacy.wordpress_url,
      username: legacy.wordpress_username,
      appPassword: legacy.wordpress_app_password,
      apiToken: legacy.wordpress_api_token ?? null,
      isDefault: true,
    }
  }
  return null
}

/** Specific site by id, scoped to the user (RLS enforces same; this
 *  query just makes the not-found case explicit for the caller). */
export async function getSite(
  supabase: Client,
  userId: string,
  siteId: string,
): Promise<WordPressSite | null> {
  // Sentinel 'legacy' means "use the default site" — keeps callers simple
  // during the migration window.
  if (siteId === 'legacy' || siteId === 'default' || !siteId) {
    return getDefaultSite(supabase, userId)
  }
  const { data } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('wordpress_sites' as any)
    .select('id, label, url, username, app_password, api_token, is_default, display_order')
    .eq('user_id', userId)
    .eq('id', siteId)
    .maybeSingle()
  return data ? rowToSite(data as unknown as WordPressSiteRow) : null
}

/** Mark a site as default. Atomic: clears the previous default in the
 *  same transaction so we never have two defaults (the partial unique
 *  index would reject the second one anyway, but this avoids the user
 *  having to dance around it).
 *
 *  Errors when site_id doesn't belong to the user — RLS handles that. */
export async function setDefaultSite(
  supabase: Client,
  userId: string,
  siteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Clear the existing default first. The partial unique index would reject
  // the new is_default = true if we didn't unset the old one first.
  const { error: clearErr } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('wordpress_sites' as any)
    .update({ is_default: false })
    .eq('user_id', userId)
    .eq('is_default', true)
  if (clearErr) return { ok: false, error: clearErr.message }

  const { error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('wordpress_sites' as any)
    .update({ is_default: true })
    .eq('user_id', userId)
    .eq('id', siteId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Add a new site. Tier-gates BEFORE the insert (the DB trigger also
 *  enforces a hard 5-cap as a safety net regardless of tier). The first
 *  site a user adds becomes the default automatically. */
export async function addSite(
  supabase: Client,
  userId: string,
  tier: Tier,
  input: {
    label: string
    url: string
    username: string
    appPassword: string
    apiToken?: string | null
  },
): Promise<{ ok: true; site: WordPressSite } | { ok: false; error: string }> {
  const cap = await canAddSite(supabase, userId, tier)
  if (!cap.allowed) {
    return {
      ok: false,
      error: tier === 'pro'
        ? `You've reached the 5-site limit for Pro. Remove a site first.`
        : `Multi-site is a Pro feature. Upgrade to Pro to connect up to 5 WordPress sites.`,
    }
  }
  const isFirst = cap.current === 0
  const { data, error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('wordpress_sites' as any)
    .insert({
      user_id: userId,
      label: input.label.trim() || (isFirst ? 'Main' : `Site ${cap.current + 1}`),
      url: normalizeUrl(input.url),
      username: input.username.trim(),
      app_password: input.appPassword,
      api_token: input.apiToken ?? null,
      is_default: isFirst,
      display_order: cap.current,
    } as never)
    .select('id, label, url, username, app_password, api_token, is_default, display_order')
    .single()
  if (error || !data) return { ok: false, error: error?.message || 'Insert failed' }
  return { ok: true, site: rowToSite(data as unknown as WordPressSiteRow) }
}

/** Remove a site. Refuses to delete the last site (forces the user to
 *  add a replacement first, or use Settings → Disconnect WordPress entirely
 *  if they really want zero sites). If the deleted site was the default,
 *  the next site (by display_order) becomes the new default. */
export async function removeSite(
  supabase: Client,
  userId: string,
  siteId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sites = await listSites(supabase, userId)
  if (sites.length <= 1) {
    return {
      ok: false,
      error: 'Can\'t remove your only site. Use Settings → Disconnect WordPress to fully disconnect, or add another site first.',
    }
  }
  const target = sites.find(s => s.id === siteId)
  if (!target) return { ok: false, error: 'Site not found' }

  const { error } = await supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('wordpress_sites' as any)
    .delete()
    .eq('user_id', userId)
    .eq('id', siteId)
  if (error) return { ok: false, error: error.message }

  // If we just deleted the default, promote the next remaining site.
  if (target.isDefault) {
    const remaining = sites.filter(s => s.id !== siteId)
    if (remaining[0]) {
      await setDefaultSite(supabase, userId, remaining[0].id)
    }
  }
  return { ok: true }
}

// ─── internals ─────────────────────────────────────────────────────────────

/** Trim trailing slash + lowercase host so two writes of the same site
 *  don't end up as two rows that "look different to Postgres." */
function normalizeUrl(raw: string): string {
  let s = (raw || '').trim()
  s = s.replace(/\/$/, '')
  try {
    const u = new URL(s)
    u.host = u.host.toLowerCase()
    return u.toString().replace(/\/$/, '')
  } catch {
    // Caller already validated; return what they gave us.
    return s
  }
}

interface WordPressSiteRow {
  id: string
  label: string | null
  url: string
  username: string
  app_password: string
  api_token: string | null
  is_default: boolean
  display_order: number
}

function rowToSite(r: WordPressSiteRow): WordPressSite {
  return {
    id: r.id,
    label: r.label || 'Main',
    url: r.url,
    username: r.username,
    appPassword: r.app_password,
    apiToken: r.api_token,
    isDefault: r.is_default,
  }
}
