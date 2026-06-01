// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Pushes the creator's newsletter status into their WordPress site's
// `affiliateos_customizations` option, so the MVP theme can auto-render
// the signup form on the home page + every blog-post sidebar WITHOUT
// the creator having to paste the [mvp-newsletter] shortcode anywhere.
//
// Called from two places:
//   * /api/wordpress/customizations POST (every Customize Blog save) —
//     bakes the newsletter fields straight into the merged payload.
//   * /api/newsletter/settings PUT (every newsletter toggle / name save)
//     — fetches existing customizations, merges newsletter, re-POSTs.
//
// Best-effort: if WP isn't connected, or the push fails, we log and
// move on. The dashboard save MUST NOT fail because WP is offline.

// We deliberately avoid importing SupabaseClient<Database> here — the two
// callers (newsletter/settings, customizations route) hand us differently-
// typed clients (server vs. service-role) and matching either narrows the
// signature for the other. Internal usage is all cast-to-any anyway.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any

interface NewsletterFields {
  enabled: boolean
  userId: string
  senderName: string | null
  // CTA copy overrides — the WP theme uses these when present, falls back
  // to its dynamic defaults otherwise. Null = use theme default.
  ctaTitle: string | null
  ctaSubtitle: string | null
  ctaButton: string | null
  /** Up to 3 benefit bullets shown in the homepage hero's left column.
   *  Theme falls back to defaults when all three are null. */
  ctaBullets: Array<string>

  // Slot overrides — the WP theme maps these strings to specific render
  // hooks in front-page.php (homepage) and single.php (sidebar). Null on
  // either side means "use the theme's default slot for that surface".
  homepagePlacement: string | null
  sidebarPlacement: string | null
  // Subscriber count — refreshed every time we push. The theme uses it
  // for the "Join N readers" social-proof line on the homepage hero
  // (only renders when N >= 50 so we don't reveal a small list).
  subscriberCount: number
}

/** Read the row + return the shape the WP option expects. Single source
 *  of truth so both call-sites push identical data. */
export async function readNewsletterFields(
  supabase: AnySupabase,
  userId: string,
): Promise<NewsletterFields> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data }, { count: activeCount }] = await Promise.all([
    supabase
      .from('newsletter_settings')
      .select('enabled,sender_name,cta_title,cta_subtitle,cta_button,cta_bullet_1,cta_bullet_2,cta_bullet_3,homepage_placement,sidebar_placement')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('newsletter_subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'active'),
  ])
  return {
    enabled: !!data?.enabled,
    userId,
    senderName: (data?.sender_name as string | null)?.trim() || null,
    ctaTitle: (data?.cta_title as string | null)?.trim() || null,
    ctaSubtitle: (data?.cta_subtitle as string | null)?.trim() || null,
    ctaButton: (data?.cta_button as string | null)?.trim() || null,
    ctaBullets: [
      (data?.cta_bullet_1 as string | null)?.trim() || '',
      (data?.cta_bullet_2 as string | null)?.trim() || '',
      (data?.cta_bullet_3 as string | null)?.trim() || '',
    ].filter(Boolean),
    homepagePlacement: (data?.homepage_placement as string | null)?.trim() || null,
    sidebarPlacement: (data?.sidebar_placement as string | null)?.trim() || null,
    subscriberCount: Number.isFinite(activeCount) ? (activeCount as number) : 0,
  }
}

/** Fetch the live WP customizations, merge in the newsletter fields, and
 *  push the merged object back. The WP plugin's
 *  /wp-json/affiliateos/v1/customizations endpoint REPLACES the whole
 *  option, so we read-modify-write to avoid clobbering other fields the
 *  user already configured (homepage ads, sidebar blocks, footer, etc.).
 *
 *  MULTI-SITE: when the user has multiple wordpress_sites connected, this
 *  pushes the newsletter status to ALL of them — the creator's intent is
 *  "show the signup form on every blog I own," not just the default site.
 *  Each site's push is isolated: one slow/failing site doesn't block the
 *  others.
 *
 *  Returns the result so callers can surface it if they want; never
 *  throws. The boolean is "did we push to at least one site?"; reason
 *  surfaces partial-failure detail when relevant. */
export async function pushNewsletterToWp(
  supabase: AnySupabase,
  userId: string,
): Promise<{ pushed: boolean; reason?: string; sites?: Array<{ siteId: string; ok: boolean; reason?: string }> }> {
  // Try the new multi-site path first.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await supabase
    .from('wordpress_sites')
    .select('id, url, username, app_password')
    .eq('user_id', userId)

  type SiteRow = { id: string; url: string; username: string; app_password: string }
  const siteRows: SiteRow[] = Array.isArray(rows) ? (rows as SiteRow[]) : []

  // Legacy fallback: no wordpress_sites rows yet → use integrations.wordpress_*
  if (siteRows.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations')
      .select('wordpress_url, wordpress_username, wordpress_app_password')
      .eq('user_id', userId)
      .single()
    if (!intRow?.wordpress_url || !intRow?.wordpress_username || !intRow?.wordpress_app_password) {
      return { pushed: false, reason: 'wordpress-not-connected' }
    }
    siteRows.push({
      id: 'legacy',
      url: intRow.wordpress_url as string,
      username: intRow.wordpress_username as string,
      app_password: intRow.wordpress_app_password as string,
    })
  }

  const newsletter = await readNewsletterFields(supabase, userId)

  // Hostinger's WAF blocks REST writes from "bare" Vercel User-Agents; the
  // browser-style UA we use everywhere else (see services/wordpress) gets
  // through. Same trick here.
  const ua = 'Mozilla/5.0 (compatible; MVP Affiliate/1.0; +https://www.mvpaffiliate.io)'

  const results = await Promise.all(siteRows.map(async (s) => {
    const wpBase = s.url.replace(/\/$/, '')
    const cleanPw = s.app_password.replace(/\s+/g, '')
    const authHeader = `Basic ${Buffer.from(`${s.username}:${cleanPw}`).toString('base64')}`

    let existing: Record<string, unknown> = {}
    try {
      const getRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`, {
        headers: { Authorization: authHeader, 'User-Agent': ua },
      })
      if (getRes.ok) existing = await getRes.json() as Record<string, unknown>
    } catch { /* start fresh — better than failing the toggle */ }

    const merged = { ...existing, newsletter }

    try {
      const postRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
          'User-Agent': ua,
        },
        body: JSON.stringify(merged),
      })
      if (!postRes.ok) {
        const text = await postRes.text().catch(() => '')
        return { siteId: s.id, ok: false, reason: `wp-${postRes.status}: ${text.slice(0, 120)}` }
      }
      return { siteId: s.id, ok: true }
    } catch (e) {
      return { siteId: s.id, ok: false, reason: e instanceof Error ? e.message : 'fetch-failed' }
    }
  }))

  const anyOk = results.some(r => r.ok)
  const allOk = results.every(r => r.ok)
  if (allOk) return { pushed: true, sites: results }
  if (anyOk) return { pushed: true, reason: 'partial', sites: results }
  return { pushed: false, reason: results[0]?.reason ?? 'all-sites-failed', sites: results }
}
