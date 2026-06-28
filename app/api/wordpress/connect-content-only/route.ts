/**
 * POST /api/wordpress/connect-content-only
 *
 * "Bring your own theme" connect (onboarding path 2). For creators who already
 * have a WordPress blog with a theme + plugins they like and only want MVP as
 * an article generator. NO MVP plugin or theme is required — we connect with a
 * standard WordPress Application Password (Basic Auth), verify it can talk to
 * the REST API, and store the credentials with content_only = true so the rest
 * of the app treats this site as content-only (plain themed CTA links, no MVP
 * theme/plugin/curation surfaces).
 *
 * Body: { url, username, appPassword }
 *
 * Differs from /connect-token (which assumes the MVP plugin is installed and
 * runs the theme/plugin post-connect setup) — this path deliberately does NONE
 * of that. plugin_missing is an EXPECTED, accepted outcome here.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { maybeEncrypt } from '@/lib/secrets'
import { assertPublicHttpUrl, SsrfBlocked } from '@/lib/ssrf-guard'
import { probeUnverifiedCreds } from '@/lib/wordpress-health'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as {
      url?: string
      username?: string
      appPassword?: string
    }

    const rawUrl = (body.url || '').trim()
    const username = (body.username || '').trim()
    const appPassword = (body.appPassword || '').replace(/\s+/g, '')
    if (!rawUrl || !username || !appPassword) {
      return NextResponse.json(
        { error: 'Enter your site URL, WordPress username, and application password.' },
        { status: 400 },
      )
    }

    // Normalize URL: add https:// if missing, strip trailing slash.
    let siteUrl = rawUrl
    if (!/^https?:\/\//i.test(siteUrl)) siteUrl = `https://${siteUrl}`
    siteUrl = siteUrl.replace(/\/+$/, '')

    // SSRF guard — never let a user-supplied URL point at internal hosts.
    try {
      await assertPublicHttpUrl(siteUrl)
    } catch (e) {
      if (e instanceof SsrfBlocked) {
        return NextResponse.json({ error: 'That URL isn\'t allowed. Use your public site address (https://your-site.com).' }, { status: 400 })
      }
      throw e
    }

    // Verify the credentials actually work against the WP REST API. For a
    // content-only site we ACCEPT 'plugin_missing' (the user has no MVP plugin
    // by design) — we only reject auth failures + unreachable sites.
    const probe = await probeUnverifiedCreds({ url: siteUrl, username, appPassword })
    if (probe.state === 'auth_failed') {
      return NextResponse.json({
        error: `${probe.message} Double-check the username and application password.`,
      }, { status: 400 })
    }
    if (probe.state === 'unreachable' || probe.state === 'no_creds') {
      return NextResponse.json({ error: probe.message }, { status: 400 })
    }

    // Store credentials + content-only flags on the legacy integrations row.
    // getDefaultSite's legacy bridge reads content_only/cta_style from here,
    // so a single-site content-only user is handled without a wordpress_sites
    // row. cta_style defaults to 'link' for content-only (matches their theme).
    await supabase.from('integrations').upsert(
      {
        user_id: user.id,
        wordpress_url: siteUrl,
        wordpress_username: username,
        wordpress_app_password: maybeEncrypt(appPassword),
        // No MVP plugin proxy on this path — use the same value so the
        // App-Password (Basic Auth) publish path is what runs.
        wordpress_api_token: maybeEncrypt(appPassword),
        setup_status: 'site_ready',
        content_only: true,
        cta_style: 'link',
      } as never,
      { onConflict: 'user_id' },
    )

    return NextResponse.json({ ok: true, siteUrl, username, contentOnly: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[connect-content-only] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
