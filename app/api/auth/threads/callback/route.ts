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

  let step = 'token_exchange'
  try {
    const redirectUri = `${appUrl}/api/auth/threads/callback`
    const { access_token, user_id } = await exchangeCodeForToken(code, redirectUri)

    step = 'save_token'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: saveErr } = await (supabase as any).from('integrations').upsert(
      { user_id: user.id, threads_access_token: access_token, threads_user_id: user_id },
      { onConflict: 'user_id' },
    )
    if (saveErr) throw new Error(saveErr.message || 'token save failed')

    return NextResponse.redirect(`${appUrl}/setup?threads_connected=1`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error(`[threads callback] ${step} failed:`, msg)
    const detail = encodeURIComponent(`${step}: ${msg}`.slice(0, 300))
    return NextResponse.redirect(`${appUrl}/setup?threads_error=${detail}`)
  }
}
