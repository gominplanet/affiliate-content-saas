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
    return NextResponse.redirect(`${appUrl || ''}/setup?tab=integrations&meta_disabled=1`)
  }
  const appId = process.env.FACEBOOK_APP_ID
  if (!appId || !appUrl) {
    return NextResponse.json({ error: 'Facebook app not configured' }, { status: 500 })
  }

  const redirectUri = `${appUrl}/api/auth/facebook/callback`
  const scope = 'pages_show_list,pages_manage_posts'

  const url = new URL('https://www.facebook.com/v19.0/dialog/oauth')
  url.searchParams.set('client_id', appId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', scope)
  url.searchParams.set('response_type', 'code')

  return NextResponse.redirect(url.toString())
}
