/**
 * POST /api/admin/cron-retry-bulk
 *
 * Bulk variant of /api/admin/cron-retry — flips MANY scheduled_posts
 * rows back to status='pending' in a single call. Used by the "Retry
 * all stuck" + "Retry all failed" buttons on /admin/cron. Saves you
 * clicking through 10+ rows when a network blip caused a batched
 * failure.
 *
 * Body: { ids: string[] }    — max 200 ids per call (safety bound)
 *
 * Returns: { ok: true, updated: number }
 *
 * Side effects (per row):
 *   - status → 'pending'
 *   - claimed_at → null
 *   - error_message preserved (audit history)
 *   - attempts NOT reset
 *
 * Admin-only.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_BATCH = 200

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tierRow } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (tierRow?.tier !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as { ids?: unknown }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : []
  if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 })
  if (ids.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Too many ids (${ids.length}); max ${MAX_BATCH} per call.` },
      { status: 400 },
    )
  }

  const admin = createAdminClient()
  // Only flip rows that are currently 'processing' (stuck) or 'failed'.
  // We deliberately don't reset pending/completed/cancelled to protect
  // against an accidental id list that includes already-good rows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('scheduled_posts')
    .update({ status: 'pending', claimed_at: null, updated_at: new Date().toISOString() })
    .in('id', ids)
    .in('status', ['processing', 'failed'])
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const updated = Array.isArray(data) ? data.length : 0
  return NextResponse.json({ ok: true, updated })
}
