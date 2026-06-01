/**
 * GET /api/wordpress/debug-write
 *
 * Self-service diagnostic for WordPress REST write failures (the "WordPress
 * is temporarily blocking sign-in" error). Walks through every layer of our
 * auth chain and reports which one breaks, with a specific fix per failure.
 *
 * Pulls:
 *   1. integrations row (sanity-check the credentials we'd use)
 *   2. GET /wp-json/wp/v2/users/me with Basic Auth — proves whether the
 *      Application Password works at all (this is what we PRIMARILY use)
 *   3. GET /wp-json/ (no auth) — proves REST API is reachable from Vercel
 *   4. GET /wp-json/mvp-affiliate/v1/ping (or any plugin endpoint) — proves
 *      the MVP plugin is installed + active
 *   5. POST a no-op write (create + delete a draft tag) with Basic Auth —
 *      proves writes specifically work, since some hosts (Hostinger,
 *      LiteSpeed) strip Authorization only on POST requests
 *
 * For each call: returns http_status + a "hint" mapping known failure modes
 * to the actual fix. No tokens or AP secrets in the response.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user }, error: userErr } = await supabase.auth.getUser()
  if (userErr || !user) {
    return NextResponse.json({
      ok: false,
      stage: 'auth',
      error: 'Not logged in.',
    }, { status: 401 })
  }

  // Multi-site: ?siteId=<uuid> targets a specific site; omitted → default.
  // Diagnostic runs against ONE site at a time — multi-site users can switch
  // siteId in the URL to diagnose each install separately.
  const url = new URL(req.url)
  const siteId = url.searchParams.get('siteId')
  const site = await getWordPressCredentials(supabase, user.id, siteId)

  if (!site) {
    return NextResponse.json({
      ok: false,
      stage: 'no_connection',
      error: 'No WordPress connection saved. Connect via Site & Integrations first.',
    })
  }

  const siteUrl = site.wordpress_url.replace(/\/$/, '')
  const username = site.wordpress_username
  const password = site.wordpress_app_password.replace(/\s+/g, '')
  const basic = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  const ua = 'Mozilla/5.0 (compatible; MVP Affiliate/1.0; +https://www.mvpaffiliate.io)'

  // ── Test 1: REST API reachable at all? ───────────────────────────────────
  const restRoot = await probe(`${siteUrl}/wp-json/`, { headers: { 'User-Agent': ua } })

  // ── Test 2: Basic Auth read — does the host pass the Authorization
  //         header through to WordPress on a GET? ──────────────────────────
  const readAuth = await probe(`${siteUrl}/wp-json/wp/v2/users/me`, {
    headers: { Authorization: basic, 'User-Agent': ua },
  })

  // ── Test 3: MVP Affiliate plugin installed + active? ─────────────────────
  // The plugin registers /wp-json/mvp-affiliate/v1/* routes. If this 404s,
  // the plugin is missing or inactive. We don't require a specific endpoint
  // to exist — just that the namespace shows up in /wp-json/.
  const restRootJson = restRoot.json as { namespaces?: string[] } | null
  const pluginActive = Array.isArray(restRootJson?.namespaces)
    && (restRootJson.namespaces.includes('mvp-affiliate/v1')
        || restRootJson.namespaces.includes('mvpaffiliate/v1'))

  // ── Test 4: Basic Auth POST write — the host might pass the Authorization
  //         header on GET but strip it on POST (Hostinger LiteSpeed default
  //         behavior). This is where most "looks fine, posts fail" bugs hide. ─
  const writeAuth = await probe(`${siteUrl}/wp-json/wp/v2/tags`, {
    method: 'POST',
    headers: {
      Authorization: basic,
      'Content-Type': 'application/json',
      'User-Agent': ua,
    },
    body: JSON.stringify({
      name: `mvp-diag-${Date.now()}`,
      description: 'temporary tag created by MVP Affiliate diagnostic — safe to delete',
    }),
  })
  // Clean up the created tag if it succeeded so we don't leave junk behind.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createdTagId = (writeAuth.json as any)?.id
  if (createdTagId) {
    await probe(`${siteUrl}/wp-json/wp/v2/tags/${createdTagId}?force=true`, {
      method: 'DELETE',
      headers: { Authorization: basic, 'User-Agent': ua },
    })
  }

  // ── Interpret ─────────────────────────────────────────────────────────────
  const issues: string[] = []
  let summary = ''

  if (!restRoot.http_status || restRoot.http_status >= 500) {
    issues.push(`🚨 REST API not reachable (HTTP ${restRoot.http_status || 'no response'}). Check the WP site is up and /wp-json/ isn\'t blocked by a firewall/CDN.`)
    summary = 'WordPress REST API itself is unreachable from our servers.'
  } else if (restRoot.http_status === 401 || restRoot.http_status === 403) {
    issues.push(`🚨 REST root /wp-json/ is being challenged (HTTP ${restRoot.http_status}). Likely a CDN/WAF rule on the site (Cloudflare, Hostinger Web Application Firewall, etc.) blocking non-browser requests to /wp-json/.`)
    summary = 'A CDN or WAF is blocking REST API access entirely.'
  }

  if (!pluginActive) {
    issues.push('🚨 MVP Affiliate plugin not detected in /wp-json/ namespaces. Install/activate v1.0.20+ from the MVP setup page — it adds the Authorization-header forwarding fix that most hosts (Hostinger, LiteSpeed) need.')
  }

  if (readAuth.http_status === 401 || readAuth.http_status === 403) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const code = (readAuth.json as any)?.code
    if (code === 'rest_not_logged_in') {
      issues.push('🚨 Authorization header stripped on GET — host hands WordPress the request with no auth at all (rest_not_logged_in). Plugin v1.0.20 should fix this; if plugin is active, check that wp-config.php doesn\'t disable Application Passwords (look for `define(\'WP_APPLICATION_PASSWORDS_AVAILABLE\', false)`).')
    } else if (code === 'rest_authentication_failed' || code === 'invalid_username') {
      issues.push('🚨 WordPress rejected the saved Application Password (likely revoked or the password was reset on the WP side). Disconnect + reconnect WordPress to mint a fresh one.')
    } else {
      issues.push(`🚨 Basic-auth GET failed (HTTP ${readAuth.http_status}, code=${code || 'unknown'}). Surface this code to support.`)
    }
  }

  if (readAuth.http_status === 200 && (writeAuth.http_status === 401 || writeAuth.http_status === 403)) {
    issues.push('🚨 Authorization header works on GET but is STRIPPED on POST — classic Hostinger/LiteSpeed default. Fix on user\'s side: 1) Confirm MVP plugin v1.0.20+ active (its .htaccess patch handles this on Apache). 2) If on LiteSpeed: add `SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1` to root .htaccess manually. 3) If on Hostinger: hPanel → Advanced → CDN → allowlist /wp-json/ from WAF challenge.')
    summary = 'Host strips Authorization header on POST writes (very common on Hostinger + LiteSpeed).'
  }

  if (writeAuth.http_status === 201 || writeAuth.http_status === 200) {
    if (issues.length === 0) {
      issues.push('✅ Everything checks out. Basic Auth + write both succeed. If you\'re still seeing the "temporarily blocking sign-in" error, the breaker may be stuck in memory from a prior failure — wait 15 minutes for it to clear, or trigger any Vercel deploy to reset it instantly.')
      summary = 'Healthy — no fix needed.'
    }
  } else if (writeAuth.http_status >= 500) {
    issues.push(`🚨 Write returned HTTP ${writeAuth.http_status} — WordPress itself errored. Check WP error logs on the user\'s host for the matching timestamp.`)
  }

  if (!summary && issues.length > 0) summary = issues[0]

  return NextResponse.json({
    ok: true,
    summary,
    issues,
    tests: {
      rest_api_reachable: restRoot,
      read_with_auth: readAuth,
      mvp_plugin_active: pluginActive,
      write_with_auth: writeAuth,
    },
    connection: {
      siteUrl,
      username,
      passwordPreview: password ? `${password.slice(0, 4)}…${password.slice(-4)}` : null,
    },
  })
}

interface ProbeResult {
  http_status: number
  json: unknown
  text_snippet?: string
  error?: string
}

async function probe(url: string, init?: RequestInit): Promise<ProbeResult> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000), redirect: 'follow' })
    const text = await res.text()
    let json: unknown
    try { json = JSON.parse(text) } catch { json = null }
    return {
      http_status: res.status,
      json,
      text_snippet: json ? undefined : text.slice(0, 200),
    }
  } catch (e) {
    return {
      http_status: 0,
      json: null,
      error: e instanceof Error ? e.message : 'unknown fetch error',
    }
  }
}
