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
  // Incremental authorization: `intent=upload` adds ONLY the sensitive
  // youtube.upload scope, on demand, when a creator opts into publishing Shorts
  // back to YouTube — so a normal YouTube connect never triggers the
  // unverified-scope warning. include_granted_scopes merges it with what they
  // already granted (we don't re-pick the account for an upgrade).
  const wantUpload = new URL(req.url).searchParams.get('intent') === 'upload'

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
    // force-ssl is a full read+write SUPERSET of the plain `youtube` scope, so it
    // alone covers every read (incl. caption download) and every write MVP does
    // (videos.update metadata/status, thumbnails.set, playlistItems.insert). We
    // request ONLY force-ssl so the restricted-scope footprint for Google
    // verification is a single scope. The plain `youtube` scope was redundant and
    // was dropped 2026-08 (existing grants are unaffected).
    'https://www.googleapis.com/auth/youtube.force-ssl',
    // Sensitive: lets MVP publish a video TO the creator's channel (Shorts
    // cross-post). Added ONLY on demand via intent=upload (incremental auth), or
    // for everyone once the flag is flipped after Google verifies the scope — so
    // a normal connect never requests upload and verification needs no upload
    // demo video.
    ...((wantUpload || youtubeUploadEnabled()) ? ['https://www.googleapis.com/auth/youtube.upload'] : []),
  ].join(' '))
  url.searchParams.set('access_type', 'offline')
  // Incremental authorization ONLY for the on-demand upload upgrade: there we
  // want to keep the scopes the user already granted and just add youtube.upload.
  // For a NORMAL connect we deliberately DON'T send include_granted_scopes —
  // otherwise Google re-merges any scope this account granted in the past (e.g.
  // the old `youtube` / `youtube.upload` we've since dropped), and because those
  // are no longer in our verified set the "Google hasn't verified this app"
  // warning comes back even though we only request the verified force-ssl scope.
  // Omitting it makes every reconnect request strictly the verified scope(s).
  if (wantUpload) url.searchParams.set('include_granted_scopes', 'true')
  // 'consent' forces a refresh token; 'select_account' shows the account/channel
  // chooser so a creator with multiple YouTube channels picks the right one. For
  // an upload-scope upgrade we skip the chooser — just add the scope to the
  // account they're already connected with, don't make them re-pick a channel.
  url.searchParams.set('prompt', wantUpload ? 'consent' : 'select_account consent')
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString())
}
