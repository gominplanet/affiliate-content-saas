// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/sale-comments — every three hours, the sale comments MVP
// posted are checked against current prices, and a comment whose sale has
// ended is edited to its after-sale version (lib/sale-comments). The comment
// stays on the video with its link and its pin; only the sale goes.
//
// ONLY A REAL ANSWER ENDS A SALE. A product whose price could not be checked
// is left alone until the next run: taking "on sale" out while the sale is
// still on would cost the creator the sales the comment was for.
//
// NOT GATED ON LABS. Only Labs users can post these, but once one is up it is
// kept true even if the preview is closed again.
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { salesNow, takeSaleOut, type SaleCommentRow } from '@/lib/sale-comments'
import { fetchKeepaTokenStatus } from '@/services/keepa'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const started = Date.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  // A failed edit (a used-up YouTube quota, a login to reconnect) is tried
  // again on the next run, as long as the sale is still over.
  const { data, error } = await sb.from('sale_comments')
    .select('id,user_id,asin,youtube_video_id,channel_id,comment_id,lasting_text,state')
    .in('state', ['on_sale', 'failed'])
    .order('last_checked_at', { ascending: true, nullsFirst: true }).limit(300)
  if (error) return NextResponse.json({ ok: false, error: error.code === '42P01' ? 'sale_comments table missing (migration 374)' : error.message })
  const rows = (data ?? []) as Array<SaleCommentRow & { asin: string; state: string }>
  if (!rows.length) return NextResponse.json({ ok: true, rows: 0 })

  const tokens = await fetchKeepaTokenStatus()
  if (tokens.tokensLeft != null && tokens.tokensLeft < 50) return NextResponse.json({ ok: true, rows: rows.length, skipped: 'keepa tokens low' })
  const now = await salesNow(sb, rows.map((r) => r.asin))

  let updated = 0, stillOn = 0, unknown = 0, failed = 0, gone = 0
  const at = new Date().toISOString()
  for (const r of rows) {
    if (Date.now() - started > 270_000) break
    const verdict = now.get(r.asin.toUpperCase()) ?? 'unknown'
    if (verdict === 'unknown') { unknown++; continue }
    if (verdict === 'on') {
      stillOn++
      // A comment whose edit failed but whose sale came back is true again.
      await sb.from('sale_comments').update({ state: 'on_sale', last_error: null, last_checked_at: at }).eq('id', r.id)
      continue
    }
    const res = await takeSaleOut(sb, r)
    if (res.state === 'updated') updated++
    else if (res.state === 'gone') gone++
    else failed++
  }
  return NextResponse.json({ ok: true, rows: rows.length, updated, stillOn, unknown, failed, gone })
}
