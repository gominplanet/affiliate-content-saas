/**
 * POST /api/auth/tiktok/disconnect
 *
 * Clears all TikTok tokens + cached identity from integrations. We do NOT
 * call TikTok's token revoke endpoint here — that path is best-effort and
 * non-fatal: nulling the columns is sufficient to disable MVP's ability to
 * post, and the access token itself expires in 24h anyway.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Best-effort revoke on TikTok's side — we don't block on failure.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: integ } = await (supabase as any)
      .from('integrations')
      .select('tiktok_access_token')
      .eq('user_id', user.id)
      .single()
    const token = integ?.tiktok_access_token as string | undefined
    const clientKey = process.env.TIKTOK_CLIENT_KEY
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET
    if (token && clientKey && clientSecret) {
      await fetch('https://open.tiktokapis.com/v2/oauth/revoke/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          token,
        }).toString(),
      }).catch(() => { /* swallow — best-effort */ })
    }
  } catch { /* non-fatal */ }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('integrations')
    .update({
      tiktok_open_id: null,
      tiktok_username: null,
      tiktok_display_name: null,
      tiktok_avatar_url: null,
      tiktok_access_token: null,
      tiktok_refresh_token: null,
      tiktok_token_expiry: null,
      tiktok_refresh_expiry: null,
      tiktok_scopes: null,
    })
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
