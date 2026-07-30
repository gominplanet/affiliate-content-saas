// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/campaigns/cc-verify  → { verified: boolean }
// POST /api/campaigns/cc-verify  → stamp cc_verified_at = now
//
// Proof-of-CC-access gate for the catalog "Browse all" view. The client calls
// POST after SCOUT has confirmed the user's own Amazon Creator Connections grid
// actually renders (a live grid scan succeeded) — so only creators who genuinely
// have CC access can browse the shared campaign catalog. Verification lasts
// VERIFY_TTL_DAYS, then re-confirms.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export const VERIFY_TTL_DAYS = 180

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ verified: false })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('integrations').select('cc_verified_at').eq('user_id', user.id).maybeSingle()
  return NextResponse.json({ verified: isFresh(data?.cc_verified_at) })
}

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('integrations').update({ cc_verified_at: new Date().toISOString() }).eq('user_id', user.id)
  if (error) return NextResponse.json({ ok: false }, { status: 200 }) // best-effort
  return NextResponse.json({ ok: true, verified: true })
}

export function isFresh(ts: string | null | undefined): boolean {
  if (!ts) return false
  const age = Date.now() - new Date(ts).getTime()
  return Number.isFinite(age) && age >= 0 && age < VERIFY_TTL_DAYS * 86_400_000
}
