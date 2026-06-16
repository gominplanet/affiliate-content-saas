import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { deleteSocialAccountsForPlatform } from '@/lib/social-accounts'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('integrations').update({
    threads_access_token: null,
    threads_user_id: null,
  }).eq('user_id', user.id)

  // Also drop the multi-account rows so a revoked Threads token doesn't linger
  // in the per-post picker. Best-effort — the legacy clear above is the gate.
  try { await deleteSocialAccountsForPlatform(supabase, user.id, 'threads') } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true })
}
