// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/usage/daily — the limits that reset over a rolling 24 hours, with
// how much is used and when the next slot frees up. Powers the usage page
// beside /api/usage/summary (the monthly caps).
//
// COUNTED THE WAY THE GATES COUNT: the same tables, the same 24 hour window,
// the same numbers (lib/daily-limits). A limit the creator's plan does not
// include is left out rather than shown as zero.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePreview } from '@/lib/labs-preview'
import { SALE_COMMENTS_PER_DAY, INDEX_NUDGES_PER_DAY } from '@/lib/daily-limits'

export const dynamic = 'force-dynamic'

interface DailyBucket {
  key: string
  label: string
  used: number
  limit: number
  /** When the oldest use in the window drops out and frees a slot; null when nothing is used. */
  nextFreeAt: string | null
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const since = new Date(Date.now() - 86_400_000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  /** Uses in the last 24 hours, oldest first, or null when the table could not be read. */
  const recent = async (table: string, col: string): Promise<string[] | null> => {
    try {
      const { data, error } = await sb.from(table).select(col).eq('user_id', user.id).gte(col, since)
        .order(col, { ascending: true }).limit(500)
      if (error) return null
      return ((data ?? []) as Array<Record<string, string>>).map((r) => r[col])
    } catch { return null }
  }
  const bucket = (key: string, label: string, times: string[], limit: number): DailyBucket => ({
    key, label, used: times.length, limit,
    nextFreeAt: times.length ? new Date(Date.parse(times[0]) + 86_400_000).toISOString() : null,
  })

  const buckets: DailyBucket[] = []
  // A bucket whose table could not be read is left out, never shown as 0 used:
  // "0 of 20" when the count failed would be a number nobody measured.
  if (canUsePreview('on_sale', intg?.tier)) {
    const t = await recent('sale_comments', 'posted_at')
    if (t) buckets.push(bucket('sale_comments', 'YouTube sale comments', t, SALE_COMMENTS_PER_DAY))
  }
  {
    const t = await recent('indexing_submissions', 'created_at')
    if (t) buckets.push(bucket('index_nudges', 'Google index requests', t, INDEX_NUDGES_PER_DAY))
  }
  return NextResponse.json({ buckets })
}
