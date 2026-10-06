import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { youtubeUploadEnabled } from '@/lib/feature-flags'
import { getOwnerUserId } from '@/lib/agency'
import { startOAuthState, callbackHostRedirect } from '@/lib/oauth-state'

export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !appUrl) {
    return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 500 })
  }

  const redirectUri = `${appUrl}/api/auth/youtube/callback`
  // START ON THE CALLBACK'S HOST so the one-time state cookie is there when
  // Google sends the member back (apex and www keep separate cookies).
  const hostHop = callbackHostRedirect(req, redirectUri)
  if (hostHop) return NextResponse.redirect(hostHop)

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  // Where to send the user after the callback. Only same-origin relative paths
  // (start with a single "/", never "//") are honoured — guards against an
  // open redirect. Used so the onboarding funnel gets the user back to
  // /onboarding instead of dumping them on /setup mid-flow.
  const rawReturn = new URL(req.url).searchParams.get('returnTo') || ''
  const returnTo = /^\/(?!\/)/.test(rawReturn) ? rawReturn : ''
  // A VIRTUAL ASSISTANT does not sign in to Google here: the tokens would land
  // on their own empty MVP account, not the owner's, and the owner's channel
  // would stay unconnected. Say so in words, and point to the way that works
  // for a VA: Connect it by link, which saves the channel on the owner.
  if ((await getOwnerUserId(user.id)) !== user.id) {
    return NextResponse.redirect(`${appUrl}${returnTo || '/connect-youtube'}${(returnTo || '').includes('?') ? '&' : '?'}youtube_error=va_owner_connects`)
  }
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
  // `verified=1` forces a strictly verified-scope reconnect: request ONLY the
  // Google-verified force-ssl scope and never add the sensitive youtube.upload
  // scope, whatever the tier or public flag. The "MVP is now verified by Google"
  // nudge uses this so that button always yields the warning-free connection it
  // promises (upload is opted into separately via intent=upload).
  const verifiedOnly = new URL(req.url).searchParams.get('verified') === '1'

  // Who may grant the sensitive youtube.upload scope. Dark to the public until
  // Google verifies it; admins can grant it now (to record the verification demo
  // + dogfood). Once NEXT_PUBLIC_YOUTUBE_UPLOAD_ENABLED flips on, everyone can.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).single()
  const uploadEligible = youtubeUploadEnabled({ tier: intRow?.tier as string | null })
  // Add the upload scope when the viewer is eligible AND either they explicitly
  // asked for it (incremental auth) or the public flag is on (grab it on connect).
  // ONLY WHEN ASKED FOR (Seb, 2026-10-07). Google has verified force-ssl but not
  // youtube.upload, and asking for upload on every connect put the "unverified
  // app" warning in front of every member and spent the 100-user cap on people
  // who never upload through the API (both paid plans upload through SCOUT in
  // Studio). A plain connect now asks only for the verified scope; the upload
  // scope is added when a member publishes a Short or a Launchpad video
  // (intent=upload), and only they see the warning.
  const addUploadScope = !verifiedOnly && uploadEligible && wantUpload

  // RANDOM, ONE-TIME STATE (lib/oauth-state). The return path and the
  // "add another channel" flag ride in the httpOnly state cookie, not the URL.
  const state = await startOAuthState('youtube', user.id, redirectUri, { rt: returnTo, add: addChannel })

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
    ...(addUploadScope ? ['https://www.googleapis.com/auth/youtube.upload'] : []),
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
