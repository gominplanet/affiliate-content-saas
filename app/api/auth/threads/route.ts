import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { metaEnabledForUser } from '@/lib/feature-flags'

export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
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
  const redirectUri = `${appUrl}/api/auth/threads/callback`

  const params = new URLSearchParams({
    client_id: process.env.THREADS_APP_ID!,
    redirect_uri: redirectUri,
    scope: 'threads_basic,threads_content_publish',
    response_type: 'code',
    // Bind the flow to this session. The callback rejects any state that
    // doesn't match the logged-in user, so an attacker can't get a victim to
    // complete an authorization the attacker started (which would bind the
    // ATTACKER's Threads account to the victim's tenant, quietly publishing
    // every future auto-post to them). Same scheme as twitter/facebook.
    state: Buffer.from(user.id).toString('base64url'),
  })

  return NextResponse.redirect(`https://threads.net/oauth/authorize?${params}`)
}
