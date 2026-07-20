import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const appId = process.env.PINTEREST_APP_ID
  // Strip any trailing slash so we never emit a double-slash redirect_uri
  // (Pinterest does an exact-string match against the registered URI).
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
  if (!appId || !appUrl) return NextResponse.json({ error: 'Pinterest app not configured' }, { status: 500 })

  const redirectUri = `${appUrl}/api/auth/pinterest/callback`
  // boards:write is REQUIRED to create a pin on a board (Pinterest
  // rejects pin creation without it).
  const scope = 'boards:read,boards:write,pins:read,pins:write,user_accounts:read'

  // A session is required to bind `state` — the callback rejects anything that
  // doesn't decode to the logged-in user, which is what stops an attacker from
  // having a victim complete an authorization the attacker started.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  const url = new URL('https://www.pinterest.com/oauth/')
  url.searchParams.set('client_id', appId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scope)
  url.searchParams.set('state', Buffer.from(user.id).toString('base64url'))

  return NextResponse.redirect(url.toString())
}
