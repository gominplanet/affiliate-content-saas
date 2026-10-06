/**
 * GET /api/auth/tiktok
 *
 * Kicks off TikTok's Login Kit OAuth flow. Redirects to www.tiktok.com/v2/
 * auth/authorize with our client key, the registered redirect URI, the
 * scopes we need for publishing, and a CSRF state token.
 *
 * Tier-gated: TikTok publish is a Pro feature (mirrors the IG / TikTok
 * vertical-short surface — both gated to Pro).
 *
 * Scopes (must match what's enabled on the TikTok app + within the
 * sandbox the caller is targeting):
 *   user.info.basic   — read the connected creator's @ + avatar
 *   video.upload      — upload the rendered vertical short
 *   video.publish     — Direct Post the video to the feed
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { startOAuthState, callbackHostRedirect } from '@/lib/oauth-state'

export async function GET(request: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  // TikTok matches redirect_uri EXACTLY (no wildcards, www ≠ non-www) and a Live
  // app's redirect URI can't be edited without a re-review. So allow an env
  // override to match whatever's registered on the TikTok app (currently the
  // non-www form). Must be identical here and in the token-exchange (callback).
  const redirectUri = process.env.TIKTOK_REDIRECT_URI || `${appUrl}/api/auth/tiktok/callback`
  // START ON THE CALLBACK'S HOST. TIKTOK_REDIRECT_URI can name a different
  // host from NEXT_PUBLIC_APP_URL, and the one-time state cookie only reaches
  // the callback if it was set on the callback's own host.
  const hostHop = callbackHostRedirect(request, redirectUri)
  if (hostHop) return NextResponse.redirect(hostHop)

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tierRow } = await supabase
    .from('integrations')
    .select('tier')
    .eq('user_id', user.id)
    .single()
  const tier = (tierRow?.tier as Tier) ?? 'trial'
  if (!tierAllowsSocial(tier, 'tiktok')) {
    return NextResponse.redirect(`${appUrl}/pricing?reason=tiktok_requires_pro`)
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY
  if (!clientKey) {
    return NextResponse.redirect(`${appUrl}/connect-socials?tiktok_error=server_not_configured`)
  }

  // CSRF state: RANDOM and ONE-TIME (lib/oauth-state), bound to this user in
  // an httpOnly cookie. TikTok echoes it back and the callback verifies and
  // burns it. The bare user id used to be the state: guessable and reusable.
  const state = await startOAuthState('tiktok', user.id, redirectUri)

  const url = new URL('https://www.tiktok.com/v2/auth/authorize/')
  url.searchParams.set('client_key', clientKey)
  url.searchParams.set('response_type', 'code')
  // Comma-separated — TikTok ignores spaces.
  //
  // SCOPE SET (must mirror what's enabled on the TikTok developer-portal app).
  //   user.info.basic    — Login Kit identity (open_id, display_name, avatar)
  //   user.info.profile  — bio + verified flag, shown in Settings → Integrations
  //   video.upload       — transfers the composed video file into the user's
  //                        TikTok account (required by Content Posting API).
  //   video.publish      — direct-posts the uploaded video to the user's feed
  //                        using the caption + privacy picked inside MVP, via
  //                        /v2/post/publish/video/init/.
  url.searchParams.set('scope', 'user.info.basic,user.info.profile,video.upload,video.publish')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString())
}
