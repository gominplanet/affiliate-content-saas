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
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Module-local (NOT exported): a route file may only export request handlers +
// route config, so exporting these tripped Next's route-type validator.
// 30 days, not 180 (Seb, 2026-10-07): access is re-proved by the next scan.
const VERIFY_TTL_DAYS = 30

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ verified: false })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('integrations').select('cc_verified_at').eq('user_id', user.id).maybeSingle()
  return NextResponse.json({ verified: isFresh(data?.cc_verified_at) })
}

// PROOF, NOT A BUTTON (Seb, 2026-10-07). This used to stamp access for anyone
// who called it, so "verified" only meant someone asked. SCOUT's scan of the
// member's own Creator Connections grid now sends the campaign ids it saw, and
// they must be real campaigns in the shared catalogue: ids only a member with
// access can see. A real member's scan proves itself with no extra step.
const MIN_MATCHED = 3

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { campaignIds?: unknown }
  const ids = [...new Set((Array.isArray(body.campaignIds) ? body.campaignIds : [])
    .map((v) => String(v ?? '').trim()).filter((v) => v && v.length <= 200))].slice(0, 200)
  if (ids.length === 0) return NextResponse.json({ ok: false, verified: false, reason: 'no-campaigns' })
  let matched = 0
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { count } = await admin.from('cc_campaign_catalog').select('campaign_id', { count: 'exact', head: true }).in('campaign_id', ids)
    matched = count ?? 0
  } catch (e) {
    console.warn('[cc-verify] catalogue check failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ ok: false, verified: false, reason: 'check-failed' })
  }
  // A small grid can show fewer than three campaigns; then every one must match.
  if (matched < Math.min(MIN_MATCHED, ids.length)) {
    return NextResponse.json({ ok: false, verified: false, reason: 'no-match', matched, sent: ids.length })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('integrations').update({ cc_verified_at: new Date().toISOString() }).eq('user_id', user.id)
  if (error) {
    // Best-effort UX (never block the browse flow), but LOG it — a silent
    // failure here makes CC verification "not stick" and re-prompt forever with
    // no trace. Surfacing it lets us see the real DB error.
    console.warn('[cc-verify] stamp failed:', error.message)
    return NextResponse.json({ ok: false }, { status: 200 })
  }
  return NextResponse.json({ ok: true, verified: true })
}

function isFresh(ts: string | null | undefined): boolean {
  if (!ts) return false
  const age = Date.now() - new Date(ts).getTime()
  return Number.isFinite(age) && age >= 0 && age < VERIFY_TTL_DAYS * 86_400_000
}
