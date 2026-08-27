/**
 * EPC library cleanup — trims the operator's per-user EPC library so the count
 * reflects what's actually live in Amazon's Sponsored Products pool instead of
 * years of accumulated scans.
 *
 * Two things inflate the library over time:
 *   1. Ended campaigns. A campaign that has passed its end date is no longer in
 *      Amazon's EPC tool, but its row lingers here forever. These are the bulk of
 *      the gap between "live in EPC" (~30k) and "rows in library" (40k+).
 *   2. Exact duplicates. epc_products has a unique (user_id, asin) constraint and
 *      the ingest upserts on it, so duplicates shouldn't exist — but if that
 *      constraint never landed on a database (partial migration, pre-existing
 *      table), repeat scans could have piled the same ASIN up as separate rows.
 *      We detect and collapse them defensively, keeping the newest scan.
 *
 * GET  → preview counts: { total, duplicates, expired } (no writes).
 * POST { mode: 'duplicates' | 'expired' | 'all' } → delete, return what was
 *       removed: { ok, removedDuplicates, removedExpired, total }.
 *
 * Operator-only (tier === 'admin'): only the operator builds + prunes the shared
 * library. Runs on the user's session client, so RLS scopes every delete to the
 * caller's own rows.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { toUserMessage } from '@/lib/friendly-error'

export const dynamic = 'force-dynamic'

// Today as an ISO date (YYYY-MM-DD) in UTC. ends_at is a plain date column, so a
// date-only comparison is what we want — a campaign whose end date is strictly
// before today is over.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

async function requireAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ig } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (normalizeTier(ig?.tier) !== 'admin') {
    return { error: NextResponse.json({ error: 'Library cleanup is operator-only.' }, { status: 403 }) }
  }
  return { supabase, userId: user.id }
}

/**
 * Rows whose ASIN appears more than once for this user — the older copies (by
 * scanned_at, then id) that should be removed to leave one row per ASIN.
 * Returns the ids to delete. One bounded read of (id, asin, scanned_at).
 */
async function findDuplicateIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('epc_products')
    .select('id, asin, scanned_at')
    .eq('user_id', userId)
  const rows = (data ?? []) as { id: string; asin: string; scanned_at: string | null }[]
  // Newest first so the first occurrence of each ASIN is the keeper.
  rows.sort((a, b) => String(b.scanned_at ?? '').localeCompare(String(a.scanned_at ?? '')))
  const keep = new Set<string>()
  const drop: string[] = []
  for (const r of rows) {
    const key = (r.asin || '').toUpperCase()
    if (!key) continue
    if (keep.has(key)) drop.push(r.id)
    else keep.add(key)
  }
  return drop
}

export async function GET() {
  try {
    const ctx = await requireAdmin()
    if ('error' in ctx) return ctx.error
    const { supabase, userId } = ctx

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalQ = await (supabase as any)
      .from('epc_products').select('id', { count: 'exact', head: true }).eq('user_id', userId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expiredQ = await (supabase as any)
      .from('epc_products').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).not('ends_at', 'is', null).lt('ends_at', todayIso())

    const dupIds = await findDuplicateIds(supabase, userId)

    return NextResponse.json({
      ok: true,
      total: totalQ.count ?? 0,
      expired: expiredQ.count ?? 0,
      duplicates: dupIds.length,
    })
  } catch (err) {
    console.error('[epc/cleanup GET]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Could not check the library.') }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin()
    if ('error' in ctx) return ctx.error
    const { supabase, userId } = ctx

    const body = await request.json().catch(() => ({})) as { mode?: string }
    const mode = body.mode === 'duplicates' || body.mode === 'expired' ? body.mode : 'all'

    let removedDuplicates = 0
    let removedExpired = 0

    // Duplicates first: collapse to one row per ASIN (keep newest scan), so the
    // expired pass then works against a clean set.
    if (mode === 'duplicates' || mode === 'all') {
      const dupIds = await findDuplicateIds(supabase, userId)
      for (let i = 0; i < dupIds.length; i += 500) {
        const batch = dupIds.slice(i, i + 500)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from('epc_products').delete().eq('user_id', userId).in('id', batch)
        if (error) throw new Error(error.message)
        removedDuplicates += batch.length
      }
    }

    // Ended campaigns: one bounded delete of everything with a known past end date.
    if (mode === 'expired' || mode === 'all') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const countQ = await (supabase as any)
        .from('epc_products').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).not('ends_at', 'is', null).lt('ends_at', todayIso())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('epc_products').delete()
        .eq('user_id', userId).not('ends_at', 'is', null).lt('ends_at', todayIso())
      if (error) throw new Error(error.message)
      removedExpired = countQ.count ?? 0
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalQ = await (supabase as any)
      .from('epc_products').select('id', { count: 'exact', head: true }).eq('user_id', userId)

    return NextResponse.json({
      ok: true,
      removedDuplicates,
      removedExpired,
      total: totalQ.count ?? 0,
    })
  } catch (err) {
    console.error('[epc/cleanup POST]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Could not clean up the library.') }, { status: 500 })
  }
}
