// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/admin/reverify-cc-prices   (admin only)
//
// Requeues live catalog rows for price re-verification by nulling their
// product_verified_at, so the enrich cron re-prices them with the Buy Box logic
// (see services/keepa — statPriceBuyBox). Signal columns are left intact; only
// the "when did we last check" stamp is cleared, which moves the row to the
// front of the cron's oldest-first queue.
//
// Chunked + resumable, mirroring the catalog merge: each call loops bounded
// batches until a soft deadline, then returns done:false so the CLIENT auto-
// calls again. A single `before` timestamp (captured on the first call, echoed
// back each resume) means rows the cron freshly re-priced mid-pass are never
// re-nulled — the pass and the cron don't fight.
//
// This does NOT spend Keepa tokens itself. The re-pricing happens later, paced,
// on the enrich cron's existing budget (~2 tokens/product, token-floor guarded).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'
import { toUserMessage } from '@/lib/friendly-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    if (normalizeTier(intRow?.tier) !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

    const body = await request.json().catch(() => ({})) as { after?: string }
    // Cursor: campaign_id we've paged up to. Empty on the first call; echoed back
    // each resume so we page forward through the table exactly once.
    let after = typeof body.after === 'string' ? body.after : ''

    const admin = createAdminClient()
    // Small page on purpose: product_verified_at is indexed, so nulling it is a
    // non-HOT update that re-inserts each row into the search_vec + asins GIN
    // indexes. GIN inserts are slow, so a big batch (5000) blows the DB
    // statement timeout — and SET LOCAL statement_timeout doesn't override it
    // under the API role. 400 rows/statement stays comfortably under the limit;
    // the server loops many pages per call and the client auto-resumes, so the
    // whole sweep still finishes, just in more, smaller steps.
    const BATCH = 400
    const deadline = Date.now() + 45_000
    let queued = 0
    let scanned = BATCH
    while (scanned >= BATCH && Date.now() < deadline) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (admin as any).rpc('reverify_cc_prices_step', { p_after: after, p_limit: BATCH })
      if (error) {
        console.error('[reverify-cc-prices step]', error.message)
        const missingFn = /could not find the function|does not exist|schema cache|PGRST202/i.test(error.message || '')
        return NextResponse.json({
          error: missingFn
            ? 'The re-verify database function is missing — run migration 208 in Supabase, then click again.'
            : toUserMessage(error, 'Re-verify stopped partway. Click again to resume.'),
          detail: error.message?.slice(0, 200), queuedSoFar: queued,
        }, { status: 500 })
      }
      // RETURNS TABLE → data is an array of one row.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = (Array.isArray(data) ? data[0] : data) as { last_id: string | null; scanned: number; updated: number } | null
      scanned = Number(row?.scanned ?? 0)
      queued += Number(row?.updated ?? 0)
      if (!row?.last_id) break // no rows left in the page → end of table
      after = row.last_id
    }

    const done = scanned < BATCH
    return NextResponse.json({ ok: true, done, queued, after })
  } catch (err) {
    console.error('[reverify-cc-prices]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Re-verify failed. Please try again.') }, { status: 500 })
  }
}
