import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { exchangeCodeForToken, getLongLivedToken, getPages } from '@/services/facebook'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const redirectUri = `${appUrl}/api/auth/facebook/callback`
  const setupUrl = `${appUrl}/setup?tab=integrations`

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(`${setupUrl}&fb_error=access_denied`)
  }

  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.redirect(`${appUrl}/login`)

    // Exchange code → short-lived token → long-lived token
    const shortToken = await exchangeCodeForToken(code, redirectUri)
    const longToken = await getLongLivedToken(shortToken)

    // Fetch pages the user manages
    const pages = await getPages(longToken)
    if (pages.length === 0) {
      return NextResponse.redirect(`${setupUrl}&fb_error=no_pages&debug_token=${encodeURIComponent(longToken)}`)
    }

    // Save the first page by default (user can switch in settings)
    const page = pages[0]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('integrations').upsert(
      {
        user_id: user.id,
        facebook_page_id: page.id,
        facebook_page_name: page.name,
        facebook_page_access_token: page.access_token,
        facebook_pages_json: JSON.stringify(pages),
      },
      { onConflict: 'user_id' },
    )

    return NextResponse.redirect(`${setupUrl}&fb_connected=1`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.redirect(`${setupUrl}&fb_error=${encodeURIComponent(msg)}`)
  }
}
