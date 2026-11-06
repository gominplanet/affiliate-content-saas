// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/trybe-products: EVERY BRAND'S PRODUCTS ON TRYBE, OVERNIGHT
// (Seb, 2026-11-06: "even if it's once a day ... gather all the information we
// need from Tribe ... to be able to have it accessed really quickly by users
// throughout the day"). The product list of every brand on TRYBE's list that
// MVP has not read in a week (lib/trybe-catalog-refresh), from TRYBE's public
// pages, so samples and products are in MVP's copy whether or not anyone's
// computer is on. vercel.json runs it a few times in the early morning; each
// run carries on where the last stopped, and stops early once none is left or
// when TRYBE asks to slow down.
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { refreshCatalogs } from '@/lib/trybe-catalog-refresh'
import { CATALOG_REFRESH_CHUNK } from '@/lib/trybe-top100'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Stop starting new passes this close to the time limit. */
const BUDGET_MS = 240_000

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const until = Date.now() + BUDGET_MS
  const sum = { passes: 0, read: 0, open: 0, refuse: 0, none: 0, failed: 0, left: null as number | null, listed: 0, refused: false }
  try {
    while (Date.now() < until - 50_000) {
      const r = await refreshCatalogs(admin, { chunk: CATALOG_REFRESH_CHUNK, budgetMs: Math.min(45_000, until - Date.now() - 5_000), workers: 4 })
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, ...sum }, { status: 500 })
      sum.passes++; sum.read += r.read; sum.open += r.open; sum.refuse += r.refuse; sum.none += r.none; sum.failed += r.failed
      sum.left = r.left; sum.listed = r.listed
      if (r.refused) { sum.refused = true; break }
      if (!r.read || !r.left) break
    }
    // What it did, kept for the team's Daily refresh card to show.
    await admin.from('trybe_directory_meta').upsert({ key: 'products_overnight', value: { at: new Date().toISOString(), ...sum }, updated_at: new Date().toISOString() })
    return NextResponse.json({ ok: true, ...sum })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'the run stopped', ...sum }, { status: 500 })
  }
}
