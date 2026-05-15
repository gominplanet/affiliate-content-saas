/**
 * POST /api/auth/instagram/disconnect
 *
 * Clears Instagram integration columns. The token itself can't be
 * revoked via API — the user has to revoke it manually at
 * instagram.com/accounts/manage_access/ if they want full revocation.
 * For our purposes, removing the token from our DB stops MVP from
 * being able to publish on their behalf.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('integrations')
      .update({
        instagram_user_id: null,
        instagram_username: null,
        instagram_access_token: null,
        instagram_token_expiry: null,
      })
      .eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
