import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { metaEnabledForUser } from '@/lib/feature-flags'
import { startOAuthState, callbackHostRedirect } from '@/lib/oauth-state'

export async function GET(request: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const redirectUri = `${appUrl}/api/auth/threads/callback`
  // START ON THE CALLBACK'S HOST so the one-time state cookie (and the session
  // read below) are on the host Threads sends the member back to.
  const hostHop = callbackHostRedirect(request, redirectUri)
  if (hostHop) return NextResponse.redirect(hostHop)
  // Read the session (no DB query) so the reviewer test account / admins can
  // start the OAuth flow while Meta is gated for the public.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!(await metaEnabledForUser(supabase, user))) {
    return NextResponse.redirect(`${appUrl}/connect-socials?meta_disabled=1`)
  }
  // A session is required to bind `state`. Without it the callback can't tell
  // whose account it's linking — which is the whole CSRF hole this closes.
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  const params = new URLSearchParams({
    client_id: process.env.THREADS_APP_ID!,
    redirect_uri: redirectUri,
    scope: 'threads_basic,threads_content_publish',
    response_type: 'code',
    // Bind the flow to this session with a RANDOM, ONE-TIME state
    // (lib/oauth-state). The callback rejects any state that is not this
    // browser's for the logged-in user, so an attacker can't get a victim to
    // complete an authorization the attacker started (which would bind the
    // ATTACKER's Threads account to the victim's tenant, quietly publishing
    // every future auto-post to them).
    state: await startOAuthState('threads', user.id, redirectUri),
  })

  return NextResponse.redirect(`https://threads.net/oauth/authorize?${params}`)
}
