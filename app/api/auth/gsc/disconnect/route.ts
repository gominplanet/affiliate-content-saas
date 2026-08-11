/**
 * POST /api/auth/gsc/disconnect
 *
 * Revokes the stored Google Search Console OAuth grant and clears the tokens +
 * property. Best-effort revoke at Google so access actually stops, not just
 * forgotten locally.
 */
import { NextResponse } from 'next/server'
import { maybeDecrypt } from '@/lib/secrets'
import { createServerClient } from '@/lib/supabase/server'
import { checkedWrite } from '@/lib/db-error'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await supabase
    .from('integrations')
    .select('gsc_oauth_access_token,gsc_oauth_refresh_token')
    .eq('user_id', user.id)
    .single()

  // Columns are stored encrypted (enc:v1:) — the revoke POST must send the
  // real token, not ciphertext, or Google rejects it and access stays live.
  const token = maybeDecrypt(row?.gsc_oauth_refresh_token) || maybeDecrypt(row?.gsc_oauth_access_token)
  if (token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(8000),
      })
    } catch { /* non-fatal — still clear locally */ }
  }

  const ok = await checkedWrite('gsc.disconnect',
    supabase.from('integrations').update({
      gsc_oauth_access_token: null,
      gsc_oauth_refresh_token: null,
      gsc_oauth_token_expiry: null,
      gsc_property: null,
    }).eq('user_id', user.id),
    { userId: user.id })
  if (!ok) return NextResponse.json({ error: 'Could not disconnect. Try again.' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
