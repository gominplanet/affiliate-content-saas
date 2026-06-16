import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { exchangeCodeForToken, fetchThreadsProfile } from '@/services/threads'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'
import { syncThreadsAccount } from '@/lib/social-accounts'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/connect-socials?threads_error=${encodeURIComponent(error || 'no_code')}`)
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  let step = 'token_exchange'
  try {
    const redirectUri = `${appUrl}/api/auth/threads/callback`
    const { access_token, user_id } = await exchangeCodeForToken(code, redirectUri)

    step = 'save_token'
    // Save the core credentials first — this must always succeed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: saveErr } = await supabase.from('integrations').upsert(
      encryptIntegrationWrite({ user_id: user.id, threads_access_token: access_token, threads_user_id: user_id }),
      { onConflict: 'user_id' },
    )
    if (saveErr) throw new Error(saveErr.message || 'token save failed')

    // Best-effort: fetch + store the @username for "Connected as @username",
    // and mirror the connection into social_accounts so Threads joins the
    // per-post multi-account picker alongside Facebook/Instagram. Wrapped
    // separately so a missing threads_username column (pre-migration 064) or a
    // profile-fetch hiccup can NEVER break the connection itself. The legacy
    // integrations.threads_* columns above stay the source of truth until the
    // post routes read social_accounts.
    try {
      const profile = await fetchThreadsProfile(access_token)
      if (profile.username) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('integrations')
          .update({ threads_username: profile.username })
          .eq('user_id', user.id)
      }
      await syncThreadsAccount(supabase, user.id, {
        externalId: user_id,
        username: profile.username ?? null,
        accessToken: access_token,
      })
    } catch { /* non-fatal — connection works without the handle */ }

    return NextResponse.redirect(`${appUrl}/connect-socials?threads_connected=1`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error(`[threads callback] ${step} failed:`, msg)
    const detail = encodeURIComponent(`${step}: ${msg}`.slice(0, 300))
    return NextResponse.redirect(`${appUrl}/connect-socials?threads_error=${detail}`)
  }
}
