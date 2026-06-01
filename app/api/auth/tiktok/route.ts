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

export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tierRow } = await (supabase as any)
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
    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&tiktok_error=server_not_configured`)
  }

  // CSRF state — TikTok echoes this back to the callback. We pass the
  // current user id so the callback can validate it matches the session
  // and bind the new TikTok tokens to the right MVP user.
  const state = user.id
  const redirectUri = `${appUrl}/api/auth/tiktok/callback`

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
