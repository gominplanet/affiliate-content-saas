import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { youtubeUploadEnabled } from '@/lib/feature-flags'

export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !appUrl) {
    return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 500 })
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  // Where to send the user after the callback. Only same-origin relative paths
  // (start with a single "/", never "//") are honoured — guards against an
  // open redirect. Used so the onboarding funnel gets the user back to
  // /onboarding instead of dumping them on /setup mid-flow.
  const rawReturn = new URL(req.url).searchParams.get('returnTo') || ''
  const returnTo = /^\/(?!\/)/.test(rawReturn) ? rawReturn : ''
  // We ALWAYS force Google's account chooser (below). This is the fix for the
  // multi-channel footgun: when a Google login owns several YouTube channels
  // (a personal channel + Brand Account channels), `prompt=consent` alone
  // silently re-auths whichever channel is that account's DEFAULT — so a creator
  // meaning to (re)connect "Channel A" would get "Channel B" instead, and
  // Co-Pilot would then read Channel B's videos. select_account surfaces the
  // channel picker on every connect so they choose the right one. `addChannel`
  // no longer changes the prompt, but we keep reading it for the state payload.
  const addChannel = new URL(req.url).searchParams.get('addChannel') === '1'

  // Encode user ID (+ optional return path) in state so the callback can
  // identify the user without a session cookie. JSON now; the callback still
  // accepts the legacy bare-uid format for any in-flight old requests.
  const state = Buffer.from(JSON.stringify({ uid: user.id, rt: returnTo, add: addChannel })).toString('base64url')
  const redirectUri = `${appUrl}/api/auth/youtube/callback`

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    // Sensitive: lets MVP publish a video TO the creator's channel (Shorts
    // cross-post). Only requested once Google has verified the app for it —
    // gated so we don't break every connect with an unverified-scope warning.
    ...(youtubeUploadEnabled() ? ['https://www.googleapis.com/auth/youtube.upload'] : []),
  ].join(' '))
  url.searchParams.set('access_type', 'offline')
  // 'consent' forces a refresh token; 'select_account' shows the account/channel
  // chooser so a creator with multiple YouTube channels picks the right one
  // instead of silently getting their Google account's default channel.
  url.searchParams.set('prompt', 'select_account consent')
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString())
}
