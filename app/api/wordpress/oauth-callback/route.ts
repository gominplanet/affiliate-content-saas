/**
 * GET /api/wordpress/oauth-callback?state=…&site_url=…&user_login=…&password=…
 *
 * The return leg of the one-click WordPress connect. WordPress redirects the
 * user here after they approve our Authorize-Application prompt — with a
 * freshly minted Application Password in the URL.
 *
 * We:
 *   1. Verify the signed `state` proves this came from our /oauth-start
 *   2. Look up the MVP user_id from the state (not from the browser session,
 *      so even if the browser session lapses the connect still completes)
 *   3. Test the credentials by hitting wp-json/wp/v2/users/me
 *   4. Persist to integrations table
 *   5. Bounce back to the setup page with a success flag
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyState } from '@/lib/wp-oauth'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const stateRaw = searchParams.get('state')
  const rejected = searchParams.get('rejected') === '1' || searchParams.get('success') === 'false'
  // eslint-disable-next-line no-console
  // Don't log user_login (PII — WP username) or site_url (creator's domain) at
  // info level. Vercel logs are visible to anyone on the project + Vercel
  // staff; we only need to know whether the params are present for
  // troubleshooting, not their values.
  console.log(`[wp-oauth-callback] hit state=${stateRaw ? 'present' : 'MISSING'} rejected=${rejected} site_url=${searchParams.get('site_url') ? 'present' : 'MISSING'} user_login=${searchParams.get('user_login') ? 'present' : 'MISSING'} pw=${searchParams.get('password') ? 'present' : 'MISSING'}`)

  // Always redirect back to the SAME hostname that hit this callback
  // (apex vs. www) so the user's Supabase auth cookie still applies and
  // the setup page can read their connection state. The /oauth-start route
  // already mirrors this — the callback URL it builds matches the host the
  // user came in on — so we just continue that chain.
  const requestUrl = new URL(request.url)
  const reqHost = request.headers.get('host') || requestUrl.host
  const reqProto = requestUrl.protocol || 'https:'
  const appUrl = reqHost
    ? `${reqProto}//${reqHost}`
    : (process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io').replace(/\/$/, '')
  const setupUrl = (params: Record<string, string>) => {
    const url = new URL(`${appUrl}/setup`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    return NextResponse.redirect(url.toString(), { status: 302 })
  }

  // ── Validate state first so we know which MVP user this is for, regardless
  //    of cookie session state ─────────────────────────────────────────────
  const state = verifyState(stateRaw)
  if (!state) {
    return setupUrl({
      wp_oauth: 'error',
      wp_oauth_reason: 'Connection link expired. Please click Connect WordPress again.',
    })
  }

  if (rejected) {
    return setupUrl({
      wp_oauth: 'rejected',
      wp_oauth_reason: 'You declined the connection on your WordPress site. Click Connect WordPress again when ready.',
    })
  }

  // ── Pull credentials WP just appended to our callback URL ────────────────
  // WordPress core ships these EXACTLY as: site_url, user_login, password.
  const wpSiteUrl = (searchParams.get('site_url') || state.siteUrl).replace(/\/$/, '')
  const userLogin = searchParams.get('user_login') || ''
  const password = searchParams.get('password') || ''

  if (!userLogin || !password) {
    return setupUrl({
      wp_oauth: 'error',
      wp_oauth_reason: 'WordPress did not return credentials. Try connecting again.',
    })
  }

  // ── Sanity check: site URL WP returned must match what the user typed.
  //    Prevents an attacker from tricking the user into authorizing site A
  //    while we record site B. ────────────────────────────────────────────
  try {
    const a = new URL(wpSiteUrl)
    const b = new URL(state.siteUrl)
    if (a.hostname.toLowerCase() !== b.hostname.toLowerCase()) {
      return setupUrl({
        wp_oauth: 'error',
        wp_oauth_reason: `Site mismatch — you typed ${b.hostname} but WordPress responded as ${a.hostname}.`,
      })
    }
  } catch {
    return setupUrl({
      wp_oauth: 'error',
      wp_oauth_reason: 'Invalid site URL from WordPress.',
    })
  }

  // ── Smoke-test the credentials before persisting. If the host strips the
  //    Authorization header (Hostinger / mod_security), better to surface
  //    that here than silently store a non-working AP. ────────────────────
  const cleanPw = password.replace(/\s+/g, '')
  const basic = `Basic ${Buffer.from(`${userLogin}:${cleanPw}`).toString('base64')}`
  let testOk = false
  try {
    const res = await fetch(`${wpSiteUrl}/wp-json/wp/v2/users/me`, {
      headers: {
        Authorization: basic,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(10_000),
    })
    testOk = res.ok
    if (!res.ok) {
      const body = await res.text()
      if (body.includes('rest_not_logged_in') || res.status === 401) {
        // Save anyway — the AP itself is valid (WP just minted it). The host
        // is the problem. The dashboard's WP connection health check will
        // surface the host-strip warning and link to the fix.
        testOk = false
      }
    }
  } catch {
    testOk = false
  }

  // ── Persist credentials. Use admin client because we're identifying the
  //    user via the signed state, not via the cookie session. ──────────────
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const { error: upsertErr } = await sb.from('integrations').upsert(
    {
      user_id: state.userId,
      wordpress_url: wpSiteUrl,
      wordpress_username: userLogin,
      wordpress_app_password: cleanPw,
      // Mirror to wordpress_api_token for legacy code paths that still read it.
      wordpress_api_token: cleanPw,
      setup_status: 'site_ready',
    },
    { onConflict: 'user_id' },
  )

  if (upsertErr) {
    // eslint-disable-next-line no-console
    console.log(`[wp-oauth-callback] DB upsert FAILED userId=${state.userId} site=${wpSiteUrl} err=${upsertErr.message}`)
    return setupUrl({
      wp_oauth: 'error',
      wp_oauth_reason: `Saved credentials failed: ${upsertErr.message}`,
    })
  }

  // eslint-disable-next-line no-console
  // Drop the WP username (PII) + site URL (identifies creator's domain) — log
  // only userId (already in Vercel logs as part of session) + testOk for ops.
  console.log(`[wp-oauth-callback] SUCCESS userId=${state.userId} testOk=${testOk}`)
  return setupUrl({
    wp_oauth: testOk ? 'connected' : 'connected_warn_host',
  })
}
