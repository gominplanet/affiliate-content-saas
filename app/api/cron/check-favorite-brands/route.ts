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

  const { data: favs } = await sb
    .from('cc_favorite_brands')
    .select('user_id, brand_key, brand_label, open_count')
  const rows = (favs ?? []) as Array<{ user_id: string; brand_key: string; brand_label: string; open_count: number }>
  if (rows.length === 0) return NextResponse.json({ ok: true, brands: 0, updated: 0 })

  // One catalog count per DISTINCT brand (same for every user who tracks it).
  const byKey = new Map<string, string>()
  for (const r of rows) if (!byKey.has(r.brand_key)) byKey.set(r.brand_key, r.brand_label)

  const openByKey = new Map<string, number>()
  for (const [key, label] of byKey) {
    const safe = label.replace(/[%_,]/g, ' ').trim()
    if (!safe) { openByKey.set(key, 0); continue }
    try {
      const { data } = await sb
        .from('cc_campaign_catalog')
        .select('available_slot, total_slot')
        .ilike('brand_name', safe)
        .limit(500)
      let open = 0
      for (const c of (data ?? []) as Array<{ available_slot: number | null; total_slot: number | null }>) {
        if (!campaignFullness(c.available_slot, c.total_slot).isFull) open++
      }
      openByKey.set(key, open)
    } catch { openByKey.set(key, 0) }
  }

  const now = new Date().toISOString()
  let updated = 0, newlyOpen = 0
  for (const r of rows) {
    const open = openByKey.get(r.brand_key) ?? 0
    const patch: Record<string, unknown> = { open_count: open, last_checked_at: now }
    // Flip 0 -> open: stamp the notification signal. Reset when it goes back to 0
    // so the next opening notifies again.
    if (open > 0 && (r.open_count ?? 0) === 0) { patch.notified_open_at = now; newlyOpen++ }
    else if (open === 0) { patch.notified_open_at = null }
    try {
      await sb.from('cc_favorite_brands').update(patch).eq('user_id', r.user_id).eq('brand_key', r.brand_key)
      updated++
    } catch { /* best-effort per row */ }
  }

  return NextResponse.json({ ok: true, brands: byKey.size, updated, newlyOpen })
}
