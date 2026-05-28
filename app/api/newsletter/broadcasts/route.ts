/**
 * GET /api/newsletter/broadcasts — recent broadcasts for the dashboard
 *
 * Returns the creator's last 30 broadcasts with subject + status +
 * recipient counters + sent_at. The dashboard renders this as a small
 * table so the creator can see "I sent 3 issues this month" at a glance.
 *
 * Cap of 30: anything older fades out of relevance for the dashboard
 * use case. If a creator ever wants the full history we'll add a
 * dedicated /newsletter/history view.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('newsletter_broadcasts')
    .select('id,subject,status,recipients_total,recipients_delivered,recipients_bounced,recipients_opened,recipients_clicked,sent_at,created_at,error_message')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ broadcasts: data ?? [] })
}
