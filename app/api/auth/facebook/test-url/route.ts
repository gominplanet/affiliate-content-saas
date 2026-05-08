import { NextResponse } from 'next/server'

export async function GET() {
  const appId = process.env.FACEBOOK_APP_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const redirectUri = `${appUrl}/api/auth/facebook/callback`
  const scope = 'pages_show_list,pages_manage_posts'

  const url = new URL('https://www.facebook.com/v19.0/dialog/oauth')
  url.searchParams.set('client_id', appId!)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', scope)
  url.searchParams.set('response_type', 'code')

  return NextResponse.json({ url: url.toString(), appId, scope, redirectUri })
}
