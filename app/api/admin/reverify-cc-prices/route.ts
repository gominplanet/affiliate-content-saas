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

    const body = await request.json().catch(() => ({})) as { before?: string }
    // Capture the cutoff once (first call), echo it back on every resume so the
    // cron's fresh re-verifications (verified_at >= before) are never re-nulled.
    const before = (typeof body.before === 'string' && body.before) ? body.before : new Date().toISOString()

    const admin = createAdminClient()
    const BATCH = 5000
    const deadline = Date.now() + 40_000
    let queued = 0
    let n = BATCH
    while (n >= BATCH && Date.now() < deadline) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (admin as any).rpc('reverify_cc_prices_step', { p_before: before, p_limit: BATCH })
      if (error) {
        console.error('[reverify-cc-prices step]', error.message)
        const missingFn = /could not find the function|does not exist|schema cache|PGRST202/i.test(error.message || '')
        return NextResponse.json({
          error: missingFn
            ? 'The re-verify database function is missing — run migration 207 in Supabase, then click again.'
            : toUserMessage(error, 'Re-verify stopped partway. Click again to resume.'),
          detail: error.message?.slice(0, 200), queuedSoFar: queued,
        }, { status: 500 })
      }
      n = Number(data ?? 0)
      queued += n
    }

    const done = n < BATCH
    return NextResponse.json({ ok: true, done, queued, before })
  } catch (err) {
    console.error('[reverify-cc-prices]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Re-verify failed. Please try again.') }, { status: 500 })
  }
}
