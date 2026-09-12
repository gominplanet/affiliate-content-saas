// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/amazon/scheduled  — the creator's Amazon social queue.
// POST /api/amazon/scheduled  — { id, action: 'cancel' } on a row not yet sent.
//
// Both composers on /amazon/social offer "Schedule post", the page walkthrough
// sells it ("Post now or schedule ... or queue it for later"), and the rows land
// in amazon_scheduled_posts. Nothing in the app has ever read that table.
//
// So the whole feature was write-only. A creator scheduled a pin, got a green
// "Scheduled for Tuesday 3:00 PM", and that was the last they ever saw of it:
// no pending list, no history, no way to cancel, and — when the cron failed —
// no failure anywhere. The publish error was written to a column with no reader.
// Migration 243 even created the index for the list ("A creator's own
// 'Scheduled' list, newest first"); the list itself was never built.
//
// Everything here is user-scoped through RLS on the caller's own client, so a
// row belonging to somebody else cannot be read or cancelled even by id.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** Rows older than this stop being interesting; the queue is a working view, not
 *  an archive. */
const MAX_ROWS = 40

export interface ScheduledRow {
  id: string
  platform: 'pinterest' | 'instagram' | 'facebook'
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  scheduledAt: string
  imageUrl: string | null
  productTitle: string | null
  asin: string | null
  externalUrl: string | null
  /** Set on a COMPLETED row: it published, and something about it is worth
   *  reading (the affiliate link was substituted). Never a failure. */
  note: string | null
  /** Set on a FAILED row: why it did not publish. */
  error: string | null
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // select('*'), NOT a named list. `note` ships in migration 329 and naming a
  // column PostgREST does not have makes it reject the ENTIRE read — which would
  // turn "your note is missing" into "your queue is empty", the exact failure
  // this route exists to end. Same lesson as lib/link-cloak getLinkStyle.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('amazon_scheduled_posts')
    .select('*')
    .eq('user_id', user.id)
    .order('scheduled_at', { ascending: false })
    .limit(MAX_ROWS)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows: ScheduledRow[] = (data ?? []).map((r: Record<string, unknown>) => {
    const status = (r.status as ScheduledRow['status']) ?? 'pending'
    const errMsg = (r.error_message as string | null) ?? null
    // error_message means "this did not publish" ONLY on a failed row. Before
    // migration 329 the cron also wrote soft notes there on completed rows, so
    // on a success it is read as a note — otherwise every published post that
    // substituted its link would show up in the queue as broken.
    const note = (r.note as string | null) ?? (status === 'completed' ? errMsg : null)
    return {
      id: String(r.id),
      platform: (r.platform as ScheduledRow['platform']) ?? 'pinterest',
      status,
      scheduledAt: String(r.scheduled_at ?? ''),
      imageUrl: (r.image_url as string | null) ?? null,
      productTitle: (r.product_title as string | null) ?? null,
      asin: (r.asin as string | null) ?? null,
      externalUrl: (r.external_url as string | null) ?? null,
      note,
      error: status === 'failed' ? errMsg : null,
    }
  })

  return NextResponse.json({ rows })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { id?: string; action?: string }
  const id = (body.id || '').trim()
  if (!id) return NextResponse.json({ error: 'Which post?' }, { status: 400 })
  if (body.action !== 'cancel') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })

  // 'pending' only. A row the cron has already claimed is mid-publish, and
  // marking it cancelled would leave the creator told it was stopped while the
  // post appears on their Page a second later.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('amazon_scheduled_posts')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({
      error: 'That post is already on its way out, so it cannot be cancelled now.',
    }, { status: 409 })
  }
  return NextResponse.json({ ok: true, id })
}
