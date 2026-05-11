import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { exchangeCodeForToken } from '@/services/threads'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/setup?threads_error=${error || 'no_code'}`)
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  try {
    const redirectUri = `${appUrl}/api/auth/threads/callback`
    const { access_token, user_id } = await exchangeCodeForToken(code, redirectUri)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('integrations').upsert(
      { user_id: user.id, threads_access_token: access_token, threads_user_id: user_id },
      { onConflict: 'user_id' },
    )

    return NextResponse.redirect(`${appUrl}/setup?threads_connected=1`)
  } catch (err) {
    return NextResponse.redirect(`${appUrl}/setup?threads_error=callback_failed`)
  }
}
