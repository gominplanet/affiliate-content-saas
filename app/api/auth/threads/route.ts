import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { metaEnabled } from '@/lib/feature-flags'

export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  // Read the session (no DB query) so the reviewer test account / admins can
  // start the OAuth flow while Meta is gated for the public.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!metaEnabled({ email: user?.email })) {
    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&meta_disabled=1`)
  }
  const redirectUri = `${appUrl}/api/auth/threads/callback`

  const params = new URLSearchParams({
    client_id: process.env.THREADS_APP_ID!,
    redirect_uri: redirectUri,
    scope: 'threads_basic,threads_content_publish',
    response_type: 'code',
  })

  return NextResponse.redirect(`https://threads.net/oauth/authorize?${params}`)
}
