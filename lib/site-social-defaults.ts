// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// PER-SITE SOCIAL ROUTING (migration 346).
//
// social_accounts is keyed on (user, platform) and is_default picks one row per
// pair. A creator with several blogs has one Facebook page per blog, so every
// site resolved to the same account and one blog's posts reached another
// blog's audience. blog_posts.wordpress_site_id has always existed and is what
// chooses the WordPress credentials to publish with; the social resolver simply
// never received it.
//
// These helpers are the read side. The decision itself lives in one place,
// lib/social-accounts' resolveSocialAccount, so every surface inherits it
// rather than each posting route asking the question its own way. That is the
// mistake this codebase has made before: three quick-post modals each answered
// "which accounts are connected" separately and two of them were fixed.
//
// A creator who sets nothing here has no rows, the resolver's site step finds
// nothing, and resolution is bit-for-bit what it was before this shipped.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Db = any

/** The 'legacy' sentinel means no wordpress_sites row exists, so there is
 *  nothing to route and the column is not even a uuid. Never query with it. */
export function isRoutableSiteId(siteId: string | null | undefined): siteId is string {
  return typeof siteId === 'string' && siteId.length > 0 && siteId !== 'legacy'
}

/**
 * The same check, shaped for a caller that already has the post row in hand.
 *
 * Several posting routes already select wordpress_site_id, so making them call
 * siteIdForPost would add a database round trip per publish to re-read a value
 * sitting in a local variable. Use this when you have the column; use
 * siteIdForPost when you only have an id.
 */
export function routableSiteId(siteId: string | null | undefined): string | null {
  return isRoutableSiteId(siteId) ? siteId : null
}

/**
 * The site a published post belongs to, for the resolver's per-site step.
 *
 * Returns null rather than throwing on anything unexpected. A lookup that fails
 * must cost the per-site routing and nothing else: the resolver then falls
 * through to the creator's user-wide default, which is a working account, and
 * the post still goes out.
 */
export async function siteIdForPost(
  db: Db, userId: string, postId: string | null | undefined,
): Promise<string | null> {
  if (!postId) return null
  try {
    const { data } = await db
      .from('blog_posts')
      .select('wordpress_site_id')
      .eq('id', postId)
      .eq('user_id', userId)
      .maybeSingle()
    const id = (data as { wordpress_site_id?: string | null } | null)?.wordpress_site_id ?? null
    return isRoutableSiteId(id) ? id : null
  } catch {
    return null
  }
}

export interface SiteSocialDefault {
  siteId: string
  platform: string
  socialAccountId: string
}

/** Every mapping this creator has set, for the settings screen. */
export async function listSiteSocialDefaults(db: Db, userId: string): Promise<SiteSocialDefault[]> {
  try {
    const { data, error } = await db
      .from('site_social_defaults')
      .select('site_id,platform,social_account_id')
      .eq('user_id', userId)
    // An un-migrated database is "no routing set", not an error worth showing.
    if (error || !Array.isArray(data)) return []
    return (data as any[]).map((r) => ({
      siteId: r.site_id, platform: r.platform, socialAccountId: r.social_account_id,
    }))
  } catch {
    return []
  }
}

/**
 * Point a site's platform at an account, or clear it.
 *
 * Clearing is a DELETE rather than a row with a null account, so "no mapping"
 * has exactly one representation. Two ways to say the same thing is how a
 * resolver ends up with a branch nobody tests.
 *
 * Ownership of BOTH sides is checked here rather than trusted from the caller.
 * RLS already scopes the write to the creator, but RLS cannot tell that the
 * social account they named is also theirs, and a mapping pointing at somebody
 * else's page would publish there.
 */
export async function setSiteSocialDefault(
  db: Db, userId: string, siteId: string, platform: string, socialAccountId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isRoutableSiteId(siteId)) return { ok: false, error: 'That site cannot have its own routing yet.' }
  if (!platform.trim()) return { ok: false, error: 'platform is required' }

  const { data: site } = await db
    .from('wordpress_sites').select('id').eq('id', siteId).eq('user_id', userId).maybeSingle()
  if (!site) return { ok: false, error: 'Site not found.' }

  if (socialAccountId === null) {
    const { error } = await db
      .from('site_social_defaults')
      .delete().eq('user_id', userId).eq('site_id', siteId).eq('platform', platform)
    return error ? { ok: false, error: error.message } : { ok: true }
  }

  const { data: acct } = await db
    .from('social_accounts').select('id')
    .eq('id', socialAccountId).eq('user_id', userId).eq('platform', platform).maybeSingle()
  if (!acct) return { ok: false, error: 'That account is not connected for this platform.' }

  const { error } = await db
    .from('site_social_defaults')
    .upsert({
      user_id: userId, site_id: siteId, platform, social_account_id: socialAccountId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'site_id,platform' })
  return error ? { ok: false, error: error.message } : { ok: true }
}
