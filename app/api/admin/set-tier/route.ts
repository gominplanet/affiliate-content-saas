/**
 * POST /api/admin/set-tier
 *
 * Sets a target user's tier. Admin-only. Uses the service-role client
 * to bypass RLS so we can upsert the integrations row regardless of
 * whether the target user has visited Setup yet.
 *
 * Body: { userId: string, tier: 'free' | 'starter' | 'growth' | 'pro' | 'admin' }
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const VALID_TIERS = ['free', 'starter', 'growth', 'pro', 'admin'] as const
type Tier = typeof VALID_TIERS[number]

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Admin gate
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: caller } = await (supabase as any)
      .from('integrations').select('tier').eq('user_id', user.id).single()
    if (caller?.tier !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const { userId, tier } = await request.json() as { userId?: string; tier?: string }
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    if (!tier || !VALID_TIERS.includes(tier as Tier)) {
      return NextResponse.json({ error: `tier must be one of: ${VALID_TIERS.join(', ')}` }, { status: 400 })
    }

    // Safety: prevent demoting yourself out of admin from this endpoint —
    // would lock you out instantly. Use SQL if you really mean to.
    if (userId === user.id && tier !== 'admin') {
      return NextResponse.json({ error: 'Use SQL to remove your own admin tier (safety check).' }, { status: 400 })
    }

    const admin = createAdminClient()
    // Upsert: if no integrations row exists yet for this user, create one.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from('integrations')
      .upsert({ user_id: userId, tier }, { onConflict: 'user_id' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, tier })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
