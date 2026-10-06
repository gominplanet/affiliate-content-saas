import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { clearChannelFailures } from '@/lib/channel-health'
import { clearConnectionHealth } from '@/lib/connection-probe'
import { exchangeCodeForToken, getLongLivedToken, getPages } from '@/services/facebook'
import { syncFacebookAccounts } from '@/lib/social-accounts'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'
import { consumeOAuthState, OAUTH_STATE_EXPIRED_MESSAGE } from '@/lib/oauth-state'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const redirectUri = `${appUrl}/api/auth/facebook/callback`
  const setupUrl = `${appUrl}/connect-socials`

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  // CONSUME THE ONE-TIME STATE FIRST (lib/oauth-state): the cookie is deleted
  // whatever happens next, so this callback URL can never be replayed.
  const verified = await consumeOAuthState('facebook', state, redirectUri)
  const stateUserId = verified?.uid ?? null

  if (error || !code) {
    return NextResponse.redirect(`${setupUrl}?fb_error=access_denied`)
  }

  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.redirect(`${appUrl}/login`)

    // CSRF check (2026-06-02 audit fix): the state must be the one-time one
    // this browser started, and it must name the current session user.
    // Without this, an attacker can lure a victim to a crafted Facebook
    // authorize URL that binds the attacker's Page (with attacker access
    // token) into the victim's MVP account on callback.
    if (!stateUserId || stateUserId !== user.id) {
      console.warn('[facebook/callback] state mismatch, possible CSRF', { hasState: !!state, sessionUid: user.id })
      return NextResponse.redirect(`${setupUrl}?fb_error=${encodeURIComponent(OAUTH_STATE_EXPIRED_MESSAGE)}`)
    }

    // Exchange code → short-lived token → long-lived token
    const shortToken = await exchangeCodeForToken(code, redirectUri)
    const longToken = await getLongLivedToken(shortToken)

    // Fetch pages the user manages
    const pages = await getPages(longToken)
    if (pages.length === 0) {
      // NO TOKEN IN THE URL (2026-10-06 security audit). This carried the
      // long-lived Facebook user token as a debug_token query param, so it sat in browser
      // history, server logs and any Referer the setup page sent. Nothing read it.
      return NextResponse.redirect(`${setupUrl}?fb_error=no_pages`)
    }

    // Pick the active page. On a RECONNECT, keep whatever page the user had
    // already chosen if it's still in the returned list — otherwise reconnecting
    // (which users do constantly to chase the Facebook per-Page opt-in) would
    // silently reset them back to pages[0], undoing their pick every time. Only a
    // first-time connect (or a selection that no longer exists) falls back to the
    // first page. The in-app picker (Connect Socials) still lets them switch.
    let page = pages[0]
    try {
      const { data: existing } = await supabase
        .from('integrations').select('facebook_page_id').eq('user_id', user.id).maybeSingle()
      const prevId = (existing?.facebook_page_id as string | null) || null
      if (prevId) {
        const kept = pages.find(p => p.id === prevId)
        if (kept) page = kept
      }
    } catch { /* first connect / no row — default to pages[0] */ }
    // Encrypt access token at rest (2026-06-02). Page id/name remain
    // plaintext — they're not secrets.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // THE ERROR IS READ, and a failure throws to the catch below so the user
    // lands on the error screen rather than a "Connected" one. Reporting a
    // connection that was never saved sends someone away believing their Page
    // is wired up, and they find out when a scheduled post silently does
    // nothing. PostgREST rejects an entire write over one unknown column too, so
    // a column shipped ahead of its migration would no-op every connect on the
    // platform while every screen still said Connected.
    const { error: saveErr } = await supabase.from('integrations').upsert(
      encryptIntegrationWrite({
        user_id: user.id,
        facebook_page_id: page.id,
        facebook_page_name: page.name,
        facebook_page_access_token: page.access_token,
        facebook_pages_json: JSON.stringify(pages),
      }),
      { onConflict: 'user_id' },
    )
    if (saveErr) throw new Error(`could not save the connection: ${saveErr.message}`)

    // Mirror ALL pages into social_accounts for the multi-account picker,
    // marking the active one as default. Best-effort — never block connect.
    try {
      await syncFacebookAccounts(supabase, user.id, pages, page.id)
    } catch (e) {
      console.warn('[facebook/callback] syncFacebookAccounts failed:', e)
    }

    // Reconnecting must clear the "needs reconnecting" alert immediately —
    // otherwise the old failures stay the newest outcomes and it keeps nagging.
    await clearChannelFailures(supabase, user.id, 'facebook')
    await clearConnectionHealth(supabase, user.id, 'facebook')
    // Started from Meta Hub: back to Meta Hub, where step 1 now shows a tick.
    const res = NextResponse.redirect(request.cookies.get('fb_return')?.value === 'meta' ? `${appUrl}/meta?fb_connected=1` : `${setupUrl}?fb_connected=1`)
    res.cookies.delete('fb_return')
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.redirect(`${setupUrl}?fb_error=${encodeURIComponent(msg)}`)
  }
}
