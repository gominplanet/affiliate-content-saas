/**
 * EPC library cleanup — trims the operator's per-user EPC library so the count
 * reflects what's actually live in Amazon's Sponsored Products pool instead of
 * years of accumulated scans.
 *
 * Why the library over-counts: EPC cards carry NO end date (Amazon doesn't show
 * one), so we can't prune by "ended." What we do have is scanned_at — every scan
 * that sees a product bumps that row's scanned_at to now. A campaign that has
 * dropped out of EPC simply stops getting re-seen, so its scanned_at goes stale
 * while live products stay fresh. So "not seen in a scan for a long time" is our
 * best proxy for "no longer live," as long as the operator has done a full crawl
 * pass recently (the SCOUT scan loops back to the top once it covers the whole
 * Accepted grid, so every live product gets its scanned_at refreshed over a cycle).
 *
 * epc_products also has a unique (user_id, asin) constraint + upsert-on-scan, so
 * exact duplicates shouldn't exist — but if that constraint never landed on a
 * database we collapse them defensively, keeping the newest scan.
 *
 * GET → preview: { total, duplicates, expired, newestScan, oldestScan,
 *                  stale: { d30, d60, d90 } } (no writes).
 * POST { mode } → delete:
 *   - { mode: 'duplicates' }            collapse exact-ASIN dupes
 *   - { mode: 'stale', days: 30|60|90 } remove rows not seen in a scan for N+ days
 *   Returns { ok, removed, total }.
 *
 * Operator-only (tier === 'admin'); runs on the session client so RLS scopes
 * every delete to the caller's own rows.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { toUserMessage } from '@/lib/friendly-error'

export const dynamic = 'force-dynamic'

// Today as an ISO date (YYYY-MM-DD, UTC) — ends_at is a plain date column.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
// ISO timestamp for "N days ago" — the staleness cutoff for scanned_at.
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
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

/** Count rows for this user whose scanned_at is older than the cutoff. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countStale(supabase: any, userId: string, days: number): Promise<number> {
  const { count } = await supabase
    .from('epc_products').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).lt('scanned_at', daysAgoIso(days))
  return count ?? 0
}

/**
 * Rows whose ASIN appears more than once for this user — the older copies (by
 * scanned_at, then id) to remove, leaving one row per ASIN. One bounded read.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findDuplicateIds(supabase: any, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('epc_products').select('id, asin, scanned_at').eq('user_id', userId)
  const rows = (data ?? []) as { id: string; asin: string; scanned_at: string | null }[]
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
    const sb = supabase as any
    const totalQ = await sb.from('epc_products').select('id', { count: 'exact', head: true }).eq('user_id', userId)
    const expiredQ = await sb.from('epc_products').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).not('ends_at', 'is', null).lt('ends_at', todayIso())
    // Crawl-coverage bookends so the operator can judge whether a full pass has
    // run recently (else "stale" would sweep up live products they just haven't
    // re-scanned yet).
    const newestQ = await sb.from('epc_products').select('scanned_at')
      .eq('user_id', userId).order('scanned_at', { ascending: false }).limit(1).maybeSingle()
    const oldestQ = await sb.from('epc_products').select('scanned_at')
      .eq('user_id', userId).order('scanned_at', { ascending: true }).limit(1).maybeSingle()

    const [d30, d60, d90, dupIds] = await Promise.all([
      countStale(sb, userId, 30),
      countStale(sb, userId, 60),
      countStale(sb, userId, 90),
      findDuplicateIds(sb, userId),
    ])

    return NextResponse.json({
      ok: true,
      total: totalQ.count ?? 0,
      expired: expiredQ.count ?? 0,
      duplicates: dupIds.length,
      newestScan: newestQ.data?.scanned_at ?? null,
      oldestScan: oldestQ.data?.scanned_at ?? null,
      stale: { d30, d60, d90 },
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    const body = await request.json().catch(() => ({})) as { mode?: string; days?: number }
    const mode = body.mode === 'duplicates' ? 'duplicates' : 'stale'
    let removed = 0

    if (mode === 'duplicates') {
      const dupIds = await findDuplicateIds(sb, userId)
      for (let i = 0; i < dupIds.length; i += 500) {
        const batch = dupIds.slice(i, i + 500)
        const { error } = await sb.from('epc_products').delete().eq('user_id', userId).in('id', batch)
        if (error) throw new Error(error.message)
        removed += batch.length
      }
    } else {
      // Stale sweep: rows not seen in a scan for N+ days. Only 30/60/90 to keep it
      // deliberate — no accidental "delete everything older than a day."
      const days = body.days === 30 || body.days === 60 || body.days === 90 ? body.days : 0
      if (!days) return NextResponse.json({ error: 'Choose a window of 30, 60, or 90 days.' }, { status: 400 })
      const cutoff = daysAgoIso(days)
      const countQ = await sb.from('epc_products').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).lt('scanned_at', cutoff)
      const { error } = await sb.from('epc_products').delete().eq('user_id', userId).lt('scanned_at', cutoff)
      if (error) throw new Error(error.message)
      removed = countQ.count ?? 0
    }

    const totalQ = await sb.from('epc_products').select('id', { count: 'exact', head: true }).eq('user_id', userId)
    return NextResponse.json({ ok: true, removed, total: totalQ.count ?? 0 })
  } catch (err) {
    console.error('[epc/cleanup POST]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Could not clean up the library.') }, { status: 500 })
  }
}
