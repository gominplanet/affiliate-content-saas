import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { clearChannelFailures } from '@/lib/channel-health'
import { exchangeCodeForToken, getLongLivedToken, getPages } from '@/services/facebook'
import { syncFacebookAccounts } from '@/lib/social-accounts'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const redirectUri = `${appUrl}/api/auth/facebook/callback`
  const setupUrl = `${appUrl}/connect-socials`

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  if (error || !code) {
    return NextResponse.redirect(`${setupUrl}?fb_error=access_denied`)
  }

  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.redirect(`${appUrl}/login`)

    // CSRF check (2026-06-02 audit fix): require the OAuth state to
    // match the current session user. Without this, an attacker can
    // lure a victim to a crafted Facebook authorize URL that binds
    // the attacker's Page (with attacker access token) into the
    // victim's MVP account on callback. We pass user.id as `state`
    // at start; if it's missing or doesn't match, abort.
    if (!state || state !== user.id) {
      console.warn('[facebook/callback] state mismatch — possible CSRF', { hasState: !!state, sessionUid: user.id })
      return NextResponse.redirect(`${setupUrl}?fb_error=state_mismatch`)
    }

    // Exchange code → short-lived token → long-lived token
    const shortToken = await exchangeCodeForToken(code, redirectUri)
    const longToken = await getLongLivedToken(shortToken)

    // Fetch pages the user manages
    const pages = await getPages(longToken)
    if (pages.length === 0) {
      return NextResponse.redirect(`${setupUrl}?fb_error=no_pages&debug_token=${encodeURIComponent(longToken)}`)
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
    await supabase.from('integrations').upsert(
      encryptIntegrationWrite({
        user_id: user.id,
        facebook_page_id: page.id,
        facebook_page_name: page.name,
        facebook_page_access_token: page.access_token,
        facebook_pages_json: JSON.stringify(pages),
      }),
      { onConflict: 'user_id' },
    )

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
    return NextResponse.redirect(`${setupUrl}?fb_connected=1`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.redirect(`${setupUrl}?fb_error=${encodeURIComponent(msg)}`)
  }
}
