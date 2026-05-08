import { NextResponse } from 'next/server'

export async function GET() {
  const appId = process.env.PINTEREST_APP_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appId || !appUrl) return NextResponse.json({ error: 'Pinterest app not configured' }, { status: 500 })

  const redirectUri = `${appUrl}/api/auth/pinterest/callback`
  const scope = 'boards:read,pins:read,pins:write,user_accounts:read'

  const url = new URL('https://www.pinterest.com/oauth/')
  url.searchParams.set('client_id', appId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scope)

  return NextResponse.redirect(url.toString())
}
