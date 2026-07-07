/**
 * PartnerBoost catalog sync — pulls the user's full joined-brand product set
 * into pb_finder_cache (migration 164) so the Finder can read it back instantly.
 *   POST → run a sweep of every joined brand, upsert all products, purge stale.
 *   GET  → { count, syncedAt } so the UI can show "synced N products, 2h ago".
 *
 * Long-running (per-brand calls across 1000+ brands); maxDuration 300 + a 260s
 * internal budget. Re-running tops up whatever the previous run didn't reach.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getExternalKey } from '@/lib/external-keys'
import { syncUserCache } from '@/lib/partnerboost-sweep'
import { tierAllowsFinders, type Tier } from '@/lib/tier'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { count } = await sb.from('pb_finder_cache').select('id', { count: 'exact', head: true })
  const { data: latest } = await sb.from('pb_finder_cache')
    .select('synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle()
  return NextResponse.json({ ok: true, count: count ?? 0, syncedAt: latest?.synced_at ?? null })
}

export async function POST() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = (intRow?.tier as Tier) ?? 'trial'
    if (!tierAllowsFinders(tier)) return NextResponse.json({ ok: false, error: 'MVP x PartnerBoost requires a Studio or Pro plan.' }, { status: 403 })

    const token = await getExternalKey(supabase, user.id, 'partnerboost')
    if (!token) return NextResponse.json({ ok: false, needsToken: true, error: 'Connect your PartnerBoost API key first.' })

    const r = await syncUserCache(supabase, user.id, token, { deadlineMs: 260_000 })
    return NextResponse.json({
      ok: true, joinedBrands: r.joinedTotal, brandsSwept: r.brandsSwept, products: r.products, timedOut: r.timedOut, syncedAt: r.syncedAt,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
