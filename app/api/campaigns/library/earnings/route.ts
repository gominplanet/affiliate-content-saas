// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/campaigns/library/earnings
//
// What Amazon has paid on each product, for the Joined Campaigns page.
//
// This is a second request on purpose. Amazon reports one row per product per
// month per stream per store, so a real account runs to tens of thousands of
// rows, and reading them inside the main library call was most of what pushed
// that function past its time limit and returned a 504 instead of a page.
//
// Splitting it costs nothing the creator cares about. The page is a work queue:
// what to make next is decided by the campaign window and whether anything has
// been published, neither of which depends on what a product has already earned.
// So the list renders immediately and this fills in the difference between
// "published" and "published and paying" whenever it arrives. If it never
// arrives, the page is still right, just less precise.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** PostgREST caps a read at a thousand rows. */
const PAGE = 1000
/** Twelve pages a chunk. Hitting this would make every total an undercount, and
 *  an undercount presented as "Amazon paid you $X" is a lie, so hitting it
 *  reports nothing rather than something wrong. */
const MAX_PAGES = 12
const CHUNK = 100

export interface EarningsTotals {
  /** False when Amazon has never been read for this account, which is a
   *  different fact from Amazon reporting zero. */
  synced: boolean
  totals: Record<string, { clicks: number; orders: number; cents: number }>
}

export async function GET() {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if ('error' in auth) return auth.error
    const { ownerId } = auth
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    // Only the products the creator has actually joined. Reading the whole
    // earnings table for an account with years of history is the cost this
    // endpoint exists to contain, not to move somewhere else.
    const { data: campaignRows } = await sb
      .from('campaigns').select('asin')
      .eq('user_id', ownerId).not('accepted_at', 'is', null).limit(1000)
    const asins = [...new Set(
      ((campaignRows ?? []) as { asin: string }[])
        .map(r => (r.asin || '').toUpperCase())
        .filter(a => /^[A-Z0-9]{10}$/.test(a)),
    )]
    if (!asins.length) return NextResponse.json({ synced: false, totals: {} } as EarningsTotals)

    const chunks: string[][] = []
    for (let i = 0; i < asins.length; i += CHUNK) chunks.push(asins.slice(i, i + CHUNK))

    type Row = { asin: string; clicks: number | null; orders: number | null; earnings_cents: number | null }
    let truncated = false
    const readChunk = async (part: string[]): Promise<Row[]> => {
      const out: Row[] = []
      for (let page = 0; page < MAX_PAGES; page++) {
        let rows: Row[] = []
        try {
          const { data } = await sb
            .from('amazon_earnings_products').select('asin, clicks, orders, earnings_cents')
            .eq('user_id', ownerId).in('asin', part).range(page * PAGE, page * PAGE + PAGE - 1)
          rows = (data ?? []) as Row[]
        } catch { break }
        out.push(...rows)
        if (rows.length < PAGE) return out
        if (page === MAX_PAGES - 1) truncated = true
      }
      return out
    }

    const pages = await Promise.all(chunks.map(readChunk))
    const totals: Record<string, { clicks: number; orders: number; cents: number }> = {}
    let synced = false
    for (const rows of pages) {
      for (const e of rows) {
        synced = true
        const a = (e.asin || '').toUpperCase()
        const prev = totals[a] ?? { clicks: 0, orders: 0, cents: 0 }
        totals[a] = {
          clicks: prev.clicks + (e.clicks ?? 0),
          orders: prev.orders + (e.orders ?? 0),
          cents: prev.cents + (e.earnings_cents ?? 0),
        }
      }
    }
    if (truncated) return NextResponse.json({ synced: false, totals: {} } as EarningsTotals)
    return NextResponse.json({ synced, totals } as EarningsTotals)
  } catch {
    // Nothing here is load-bearing. A failure means the page shows "published"
    // where it could have shown "published and paying", and says nothing false.
    return NextResponse.json({ synced: false, totals: {} } as EarningsTotals)
  }
}
