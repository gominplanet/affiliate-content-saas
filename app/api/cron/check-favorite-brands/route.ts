// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/check-favorite-brands  (Vercel cron; Bearer CRON_SECRET)
//
// Keeps every creator's favorite-brands watchlist fresh so they don't have to
// check Creator Connections daily for a full campaign to reopen. For each
// distinct favorited brand it counts the OPEN campaigns in the shared catalog,
// writes the snapshot onto every user's row, and stamps notified_open_at the
// moment a brand flips from 0 open to some open (the signal the daily digest /
// a push can act on). Read-only against the catalog; idempotent.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { campaignFullness } from '@/lib/cc-intelligence'
import { ccScanBrandCampaigns } from '@/lib/cc-brand-scan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // EVERY ROW, PAGED. One unpaged read stops at the server's 1,000 row cap, so
  // every favorite past it was never refreshed and its count froze.
  const started = Date.now()
  const left = () => maxDuration * 1000 - 20_000 - (Date.now() - started)
  const rows: Array<{ user_id: string; brand_key: string; brand_label: string; open_count: number; last_checked_at: string | null }> = []
  for (let from = 0; from < 50_000; from += 1000) {
    const { data: favs, error } = await sb
      .from('cc_favorite_brands')
      .select('user_id, brand_key, brand_label, open_count, last_checked_at')
      .order('user_id').order('brand_key')
      .range(from, from + 999)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    rows.push(...((favs ?? []) as typeof rows))
    if (!favs || favs.length < 1000) break
  }
  if (rows.length === 0) return NextResponse.json({ ok: true, brands: 0, updated: 0 })

  // One catalog count per DISTINCT brand (same for every user who tracks it).
  // Least recently checked first, so a run that runs out of time leaves the
  // freshest brands for the next one rather than the same tail every time.
  const byKey = new Map<string, string>()
  const stalest = [...rows].sort((a, b) => (a.last_checked_at ?? '').localeCompare(b.last_checked_at ?? ''))
  for (const r of stalest) if (!byKey.has(r.brand_key)) byKey.set(r.brand_key, r.brand_label)

  const openByKey = new Map<string, number>()
  let unchecked = 0
  for (const [key, label] of byKey) {
    // Out of time: the rest keep their last count and are checked next run.
    if (left() < 30_000) { unchecked++; continue }
    try {
      // The SAME scan the watchlist badge and Accept all read: still-running
      // only, deterministically ordered. This query had neither, so a campaign
      // that ENDED months ago with slots frozen open counted as open here, and
      // this cron is what stamps notified_open_at. A brand whose only "open"
      // campaign had already ended flipped 0 to open once and then sat there,
      // pushing a reopened-brand alert for something nobody could join.
      //
      // Cross-user by design: one count per distinct brand, shared by everyone
      // tracking it, so the per-user already-joined exclusion the badge applies
      // is deliberately not used here.
      const { rows: scan } = await ccScanBrandCampaigns(sb, label)
      let open = 0
      for (const c of scan) {
        if (campaignFullness(c.available_slot, c.total_slot).isFull) continue
        // No ASIN means nothing to accept, so counting it would notify about a
        // campaign the Accept button cannot act on.
        if (!String(c.rep_asin || (Array.isArray(c.asins) ? c.asins[0] : '') || '').trim()) continue
        open++
      }
      openByKey.set(key, open)
    } catch {
      // A SCAN THAT FAILED IS NOT ZERO OPEN. Writing 0 here showed the member
      // "none open" and cleared notified_open_at, so the next good scan
      // announced the same reopening a second time. Left as it was instead.
      unchecked++
    }
  }

  const now = new Date().toISOString()
  let updated = 0, newlyOpen = 0
  const writeRow = async (r: (typeof rows)[number]) => {
    const open = openByKey.get(r.brand_key) ?? 0
    const patch: Record<string, unknown> = { open_count: open, last_checked_at: now }
    // Flip 0 -> open: stamp the notification signal. Reset when it goes back to 0
    // so the next opening notifies again.
    if (open > 0 && (r.open_count ?? 0) === 0) { patch.notified_open_at = now; newlyOpen++ }
    else if (open === 0) { patch.notified_open_at = null }
    const { error } = await sb.from('cc_favorite_brands').update(patch).eq('user_id', r.user_id).eq('brand_key', r.brand_key)
    if (!error) updated++
  }
  const checkedRows = rows.filter((r) => openByKey.has(r.brand_key))
  for (let i = 0; i < checkedRows.length; i += 20) await Promise.all(checkedRows.slice(i, i + 20).map(writeRow))

  return NextResponse.json({ ok: true, brands: byKey.size, unchecked, rows: rows.length, updated, newlyOpen })
}
