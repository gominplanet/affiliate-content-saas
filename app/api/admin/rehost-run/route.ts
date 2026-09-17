// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/admin/rehost-run
//
// Run the hot-linked sweep now and hand back what it actually did.
//
// The sweep runs on a schedule and reports into a Vercel log. After its first
// scheduled run I checked the one creator site I can see from outside and found
// every post unchanged, and I could not tell whether that meant the run had
// failed or had simply worked on three creators whose sites I cannot see. An
// unattended repair you cannot ask "what did you just do" is the same shape of
// problem as the bug it repairs.
//
// So the sweep is callable on demand, by an admin, and returns the full report:
// per creator, how many pictures moved, how many the site refused, and how many
// originals are gone for good.
//
// Same code path as the cron, deliberately. A "Run now" that took a different
// route would tell you about itself rather than about the thing on the schedule.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { runHotlinkedSweep } from '@/lib/rehost-sweep'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((caller as any)?.tier !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 })
  }

  const report = await runHotlinkedSweep('admin')
  return NextResponse.json(report)
}
