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
    (supabase as any)
      .from('newsletter_settings')
      .select('enabled,sender_name,cta_title,cta_subtitle,cta_button,homepage_placement,sidebar_placement')
      .eq('user_id', userId)
      .maybeSingle(),
    (supabase as any)
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
 *  Returns the result so callers can surface it if they want; never
 *  throws. */
export async function pushNewsletterToWp(
  supabase: AnySupabase,
  userId: string,
): Promise<{ pushed: boolean; reason?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url, wordpress_username, wordpress_app_password')
    .eq('user_id', userId)
    .single()
  if (!intRow?.wordpress_url || !intRow?.wordpress_username || !intRow?.wordpress_app_password) {
    return { pushed: false, reason: 'wordpress-not-connected' }
  }

  const wpBase = (intRow.wordpress_url as string).replace(/\/$/, '')
  const cleanPw = (intRow.wordpress_app_password as string).replace(/\s+/g, '')
  const authHeader = `Basic ${Buffer.from(`${intRow.wordpress_username}:${cleanPw}`).toString('base64')}`
  // Hostinger's WAF blocks REST writes from "bare" Vercel User-Agents; the
  // browser-style UA we use everywhere else (see services/wordpress) gets
  // through. Same trick here.
  const ua = 'Mozilla/5.0 (compatible; MVP Affiliate/1.0; +https://www.mvpaffiliate.io)'

  let existing: Record<string, unknown> = {}
  try {
    const getRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`, {
      headers: { Authorization: authHeader, 'User-Agent': ua },
    })
    if (getRes.ok) existing = await getRes.json() as Record<string, unknown>
  } catch { /* start fresh — better than failing the toggle */ }

  const newsletter = await readNewsletterFields(supabase, userId)
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
      return { pushed: false, reason: `wp-${postRes.status}: ${text.slice(0, 120)}` }
    }
    return { pushed: true }
  } catch (e) {
    return { pushed: false, reason: e instanceof Error ? e.message : 'fetch-failed' }
  }
}
