import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { metaEnabledForUser } from '@/lib/feature-flags'

export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  // Read the session (no DB query) so the reviewer test account / admins can
  // start the OAuth flow while Meta is gated for the public.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!(await metaEnabledForUser(supabase, user))) {
    return NextResponse.redirect(`${appUrl || ''}/connect-socials?meta_disabled=1`)
  }
  const appId = process.env.FACEBOOK_APP_ID
  if (!appId || !appUrl) {
    return NextResponse.json({ error: 'Facebook app not configured' }, { status: 500 })
  }

  const redirectUri = `${appUrl}/api/auth/facebook/callback`
  // business_management surfaces Business-Manager-owned / New Pages Experience
  // Pages (the /me/accounts-empty case). It works immediately for the app's own
  // admins/devs/testers; for customers it's granted only after App Review and
  // is silently dropped until then — so it can't regress the live connect flow.
  // Comment→DM (Private Replies) needs pages_messaging (send) +
  // pages_read_engagement (read comments) + pages_manage_metadata (subscribe the
  // Page to feed webhooks). Env-gated so we only request them once the feature
  // is App-Review-approved — set FB_DM_SCOPES=true, reconnect, set it back false
  // (mirrors the Instagram IG_DM_SCOPES flow). Granted scopes stick on the token.
  const scope = process.env.FB_DM_SCOPES === 'true'
    ? 'pages_show_list,pages_manage_posts,business_management,pages_messaging,pages_read_engagement,pages_manage_metadata'
    : 'pages_show_list,pages_manage_posts,business_management'

  // CSRF protection: pass the user's id as `state`, then verify at the
  // callback that the returning user matches. Without this, an attacker
  // could lure a logged-in victim into clicking a crafted Facebook
  // authorize URL with the attacker's app/page params and bind the
  // attacker's Page into the victim's account. Found in 2026-06-02
  // audit. Matches the pattern already used by /api/auth/twitter.
  if (!user) return NextResponse.redirect(`${appUrl}/login?from=facebook`)

  const url = new URL('https://www.facebook.com/v19.0/dialog/oauth')
  url.searchParams.set('client_id', appId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', scope)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', user.id)

  return NextResponse.redirect(url.toString())
}
