// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/admin/backfill-cc-asins   (admin only)
//
// Paced backfill: for catalog rows with an empty asins[] whose campaign name
// carries a B0-ASIN, fill asins from the name (which also fills the generated
// rep_asin, so the enrich cron can finally reach them). Chunked + resumable via
// a primary-key cursor — small batches, since updating asins churns the asins
// GIN + rep_asin indexes and a big statement would hit the DB statement timeout.

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
    let after = typeof body.after === 'string' ? body.after : ''

    const admin = createAdminClient()
    const BATCH = 400
    const deadline = Date.now() + 45_000
    let filled = 0
    let scanned = BATCH
    while (scanned >= BATCH && Date.now() < deadline) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (admin as any).rpc('backfill_cc_asins_step', { p_after: after, p_limit: BATCH })
      if (error) {
        console.error('[backfill-cc-asins]', error.message)
        const missingFn = /could not find the function|does not exist|schema cache|PGRST202/i.test(error.message || '')
        return NextResponse.json({
          error: missingFn
            ? 'The backfill function is missing — run migration 211 in Supabase, then click again.'
            : toUserMessage(error, 'Backfill stopped partway. Click again to resume.'),
          detail: error.message?.slice(0, 200), filledSoFar: filled,
        }, { status: 500 })
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = (Array.isArray(data) ? data[0] : data) as { last_id: string | null; scanned: number; updated: number } | null
      scanned = Number(row?.scanned ?? 0)
      filled += Number(row?.updated ?? 0)
      if (!row?.last_id) break // end of table
      after = row.last_id
    }

    const done = scanned < BATCH
    return NextResponse.json({ ok: true, done, filled, after })
  } catch (err) {
    console.error('[backfill-cc-asins]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Backfill failed. Please try again.') }, { status: 500 })
  }
}
