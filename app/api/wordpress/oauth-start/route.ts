/**
 * GET /api/wordpress/oauth-start?siteUrl=…
 *
 * One-click WordPress connect — entry point. Redirects the user's browser to
 * their own WP site's built-in Authorize-Application screen, where WP itself
 * will mint an Application Password and redirect back to us with it.
 *
 * No plugin install, no copy-paste, no typed username/password. Built into
 * WordPress core since 5.6.
 *
 * Docs: https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import {
  signState,
  normalizeWpSiteUrl,
  MVP_WP_APP_ID,
  MVP_WP_APP_NAME,
} from '@/lib/wp-oauth'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const raw = searchParams.get('siteUrl')
  const siteUrl = normalizeWpSiteUrl(raw)
  if (!siteUrl) {
    return NextResponse.json({
      error: 'Enter a valid WordPress site URL (e.g. https://yoursite.com).',
    }, { status: 400 })
  }

  // Sign state so the callback can verify it really came from us and recover
  // which MVP user is connecting + which site URL they typed.
  const state = signState({ userId: user.id, siteUrl })

  // The callback URL on OUR side. Critical: must use the SAME hostname the
  // user came in on (apex vs. www), not whatever NEXT_PUBLIC_APP_URL is —
  // otherwise the user gets redirected back to a host their auth cookie
  // doesn't cover and shows up "logged out" after the OAuth round-trip.
  // Falls back to NEXT_PUBLIC_APP_URL if the Host header is missing.
  const requestUrl = new URL(request.url)
  const reqHost = request.headers.get('host') || requestUrl.host
  const reqProto = requestUrl.protocol || 'https:'
  const appUrl = reqHost
    ? `${reqProto}//${reqHost}`
    : (process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io').replace(/\/$/, '')
  const successUrl = `${appUrl}/api/wordpress/oauth-callback?state=${encodeURIComponent(state)}`
  const rejectUrl = `${appUrl}/api/wordpress/oauth-callback?state=${encodeURIComponent(state)}&rejected=1`

  // WordPress core's Authorize-Application endpoint. WP shows the user a
  // native "MVP Affiliate wants access to your site" prompt with our app
  // name and asks them to approve or reject. On approve, WP creates an
  // Application Password named after our app_name and redirects to
  // success_url with these query params appended:
  //   site_url=<their URL>
  //   user_login=<the WP username that approved>
  //   password=<the freshly minted Application Password>
  // On reject, WP redirects to reject_url with `success=false` (we encode
  // our own `rejected=1` flag so we can show a friendly error).
  // Defensive: strip any trailing slash off siteUrl before concat so we
  // don't end up with `//wp-admin/...` even if normalizeWpSiteUrl is bypassed
  // or returns a stale shape. Some WP installs route `//` paths to wp-login
  // with redirect_to pointing at the apex domain, which breaks the session
  // cookie after login.
  const cleanSiteUrl = siteUrl.replace(/\/+$/, '')
  const wpAuthUrl = new URL(`${cleanSiteUrl}/wp-admin/authorize-application.php`)
  wpAuthUrl.searchParams.set('app_name', MVP_WP_APP_NAME)
  wpAuthUrl.searchParams.set('app_id', MVP_WP_APP_ID)
  wpAuthUrl.searchParams.set('success_url', successUrl)
  wpAuthUrl.searchParams.set('reject_url', rejectUrl)

  return NextResponse.redirect(wpAuthUrl.toString(), { status: 302 })
}
