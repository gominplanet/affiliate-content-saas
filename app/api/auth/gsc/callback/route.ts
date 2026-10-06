/**
 * GET /api/auth/gsc/callback — finish the GSC OAuth flow.
 *
 * Exchanges the code for tokens, stores them on integrations.gsc_oauth_*, then
 * auto-resolves the GSC property that matches the user's WordPress site and
 * saves it. Surfaces Google's real error reason on failure.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { listGscSites, resolveGscProperty } from '@/lib/gsc'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'
import { fetchWithTimeout } from '@/lib/fetch-timeout'
import { consumeOAuthState, OAUTH_STATE_EXPIRED_MESSAGE } from '@/lib/oauth-state'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  // CONSUME THE ONE-TIME STATE FIRST (lib/oauth-state): the cookie is deleted
  // whatever happens next, so a callback URL can never be replayed. The return
  // path (e.g. Brand Profile) comes from the httpOnly cookie.
  const verified = await consumeOAuthState('gsc', state, `${appUrl}/api/auth/gsc/callback`)
  const userId: string | null = verified?.uid ?? null
  let returnTo = ''
  const rt = verified?.data.rt
  if (typeof rt === 'string' && /^\/(?!\/)/.test(rt)) returnTo = rt

  const dest = (params: string) =>
    returnTo
      ? `${appUrl}${returnTo}${returnTo.includes('?') ? '&' : '?'}${params}`
      : `${appUrl}/brand?${params}`

  if (error || !code) {
    return NextResponse.redirect(dest(`gsc_error=${encodeURIComponent(error || 'no_code')}`))
  }

  // THE STATE MUST BE OURS AND NAME THE SIGNED-IN USER (2026-10-06 audit). Same
  // hole as the YouTube callback: a link carrying someone else's Google code
  // and no state put THEIR Search Console on the clicker's account.
  {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.redirect(`${appUrl}/login`)
    if (!userId || userId !== user.id) {
      console.warn('[gsc/callback] state mismatch, possible CSRF', { hasState: !!userId, sessionUid: user.id })
      return NextResponse.redirect(dest(`gsc_error=${encodeURIComponent(OAUTH_STATE_EXPIRED_MESSAGE)}`))
    }
  }

  let step = 'token_exchange'
  try {
    const redirectUri = `${appUrl}/api/auth/gsc/callback`
    const tokenRes = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })
    if (!tokenRes.ok) {
      const raw = await tokenRes.text().catch(() => '')
      let detail = raw
      try { const j = JSON.parse(raw); detail = j.error_description || j.error || raw } catch { /* keep raw */ }
      throw new Error(`Token exchange ${tokenRes.status}: ${String(detail).slice(0, 200)} (redirect_uri=${redirectUri})`)
    }
    const tokens = await tokenRes.json() as { access_token: string; refresh_token?: string; expires_in: number }

    step = 'resolve_property'
    const supabase = await createServerClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: integ } = await supabase
      .from('integrations').select('wordpress_url').eq('user_id', userId).maybeSingle()
    let property: string | null = null
    try {
      const sites = await listGscSites(tokens.access_token)
      property = integ?.wordpress_url ? resolveGscProperty(sites, integ.wordpress_url) : null
      // Fall back to the first usable property so the connection isn't dead if
      // the WP host doesn't exactly match (user can change it later).
      if (!property && sites.length) {
        property = sites.find(s => /Owner|Full/i.test(s.permissionLevel))?.siteUrl ?? sites[0].siteUrl
      }
    } catch { /* property stays null; connection still saved */ }

    step = 'save_token'
    // Encrypt OAuth tokens at rest (2026-06-02).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: saveErr } = await supabase.from('integrations').upsert(
      encryptIntegrationWrite({
        user_id: userId,
        gsc_oauth_access_token: tokens.access_token,
        ...(tokens.refresh_token && { gsc_oauth_refresh_token: tokens.refresh_token }),
        gsc_oauth_token_expiry: Date.now() + tokens.expires_in * 1000,
        ...(property && { gsc_property: property }),
      }),
      { onConflict: 'user_id' },
    )
    if (saveErr) throw new Error(saveErr.message || 'token save failed')

    const tail = property ? `gsc_property=${encodeURIComponent(property)}` : 'gsc_no_property=1'
    return NextResponse.redirect(dest(`gsc_connected=1&${tail}`))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error(`[gsc callback] ${step} failed:`, msg)
    const detail = encodeURIComponent(`${step}: ${msg}`.slice(0, 300))
    return NextResponse.redirect(dest(`gsc_error=${detail}`))
  }
}
