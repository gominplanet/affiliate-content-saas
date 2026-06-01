/**
 * POST /api/seo/purge-sitemap
 *
 * Asks the MVP WordPress plugin (v1.0.13+) to purge the host sitemap cache so
 * newly published posts appear in the sitemap immediately instead of waiting
 * out a multi-day cache TTL. Lets the dashboard clear a stale-sitemap warning
 * without a wp-admin trip.
 *
 * MULTI-SITE: this is a site-level action — there's no per-post target. We
 * fan-out across ALL of the user's connected WordPress sites and report
 * which succeeded / failed. A Pro user with 3 sites gets a 1-click purge
 * that hits all 3.
 *
 * Accepts an optional `siteId` body param to purge ONE specific site only,
 * for when the user knows exactly what they want (e.g. the SEO page button
 * is per-site in a future iteration).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { listSites, getWordPressCredentials } from '@/lib/wordpress-sites'

export const maxDuration = 60

interface SiteResult { site: string; ok: boolean; error?: string }

async function purgeOne(
  creds: {
    wordpress_url: string
    wordpress_username: string
    wordpress_app_password: string
    site_label: string
  },
): Promise<SiteResult> {
  const wpBase = creds.wordpress_url.replace(/\/$/, '')
  const auth = `Basic ${Buffer.from(`${creds.wordpress_username}:${creds.wordpress_app_password.replace(/\s+/g, '')}`).toString('base64')}`
  try {
    const res = await fetch(`${wpBase}/wp-json/affiliateos/v1/purge-sitemap`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    if (res.status === 404) {
      return { site: creds.site_label, ok: false, error: 'Plugin v1.0.13+ required.' }
    }
    if (!res.ok) {
      return { site: creds.site_label, ok: false, error: `WordPress returned ${res.status}.` }
    }
    return { site: creds.site_label, ok: true }
  } catch (err) {
    return { site: creds.site_label, ok: false, error: err instanceof Error ? err.message : 'WordPress unreachable' }
  }
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { siteId?: string | null }

  // ── Single-site mode (siteId provided) ────────────────────────────────────
  if (body.siteId) {
    const site = await getWordPressCredentials(supabase, user.id, body.siteId)
    if (!site) return NextResponse.json({ error: 'WordPress not connected for that site.' }, { status: 400 })
    const r = await purgeOne(site)
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error === 'Plugin v1.0.13+ required.'
          ? 'Sitemap refresh needs the MVP plugin v1.0.13+ on this site — update it (Setup → reinstall, or the dashboard "Update now"), then try again.'
          : r.error },
        { status: r.error === 'Plugin v1.0.13+ required.' ? 409 : 502 },
      )
    }
    return NextResponse.json({ ok: true, sites: [r] })
  }

  // ── Multi-site fan-out ───────────────────────────────────────────────────
  const sites = await listSites(supabase, user.id)
  if (sites.length === 0) {
    // No wordpress_sites yet → legacy single-site bridge.
    const def = await getWordPressCredentials(supabase, user.id)
    if (!def) return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
    const r = await purgeOne(def)
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error === 'Plugin v1.0.13+ required.'
          ? 'Sitemap refresh needs the MVP plugin v1.0.13+ — update it (Setup → reinstall, or the dashboard "Update now"), then try again.'
          : r.error },
        { status: r.error === 'Plugin v1.0.13+ required.' ? 409 : 502 },
      )
    }
    return NextResponse.json({ ok: true, sites: [r] })
  }

  // Resolve creds for each connected site, then purge in parallel.
  const results = await Promise.all(sites.map(async (s) => {
    const creds = await getWordPressCredentials(supabase, user.id, s.id)
    if (!creds) return { site: s.label, ok: false, error: 'credentials unavailable' }
    return purgeOne(creds)
  }))

  // If every site failed with the same plugin-version error, return 409 so
  // the UI shows a clear "update the plugin" CTA. If MIXED results, we still
  // return 200 with per-site detail.
  const allFailedPluginVersion = results.every(r => !r.ok && r.error?.includes('v1.0.13'))
  if (allFailedPluginVersion) {
    return NextResponse.json(
      { error: 'Sitemap refresh needs the MVP plugin v1.0.13+ on every site — update them (Setup → reinstall), then try again.', sites: results },
      { status: 409 },
    )
  }

  const anySuccess = results.some(r => r.ok)
  return NextResponse.json({ ok: anySuccess, sites: results }, { status: anySuccess ? 200 : 502 })
}
