/**
 * POST /api/auth/youtube/disconnect
 *
 * Revokes the stored Google/YouTube OAuth grant and clears the tokens.
 * Best-effort revoke at Google so access actually stops (not just
 * forgotten locally) — matters for the OAuth verification demo.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await supabase
    .from('integrations')
    .select('youtube_oauth_access_token,youtube_oauth_refresh_token')
    .eq('user_id', user.id)
    .single()

  const token = row?.youtube_oauth_refresh_token || row?.youtube_oauth_access_token
  if (token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(8000),
      })
    } catch { /* non-fatal — still clear locally */ }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('integrations').update({
    youtube_oauth_access_token: null,
    youtube_oauth_refresh_token: null,
    youtube_oauth_token_expiry: null,
  }).eq('user_id', user.id)

  return NextResponse.json({ ok: true })
}
