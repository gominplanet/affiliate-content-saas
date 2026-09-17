// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/missed-schedules
//
// Scheduled posts whose time came and went with no publish recorded.
//
// Reported as "scheduling two posts a day and some don't go through". There are
// two scheduling modes and only one of them is ours:
//
//   draft-flip   our cron flips the post to publish. We own it and we retry.
//   wp-native    WordPress holds status=future + post_date and ITS OWN cron
//                flips it. We hand the post over and never look again.
//
// WordPress's wp-cron only fires when somebody visits the site. On a blog with
// little traffic a scheduled post sits in `future` past its time and WordPress
// records a "Missed schedule". Two a day is exactly the cadence where that
// starts to show, and nothing in MVP would ever say so, because nothing asks.
//
// So this asks. It reports what is late rather than what was intended, and it
// keeps the two modes apart: a late wp-native post is the creator's wp-cron, a
// late draft-flip post is ours and is a bug on this side.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Under this a post is simply not due yet, or is mid-flight on the tick that
// publishes it. Late means late, not "a minute has passed".
const LATE_AFTER_MINUTES = 30

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const { data: caller } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((caller as any)?.tier !== 'admin') {
      return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const cutoff = new Date(Date.now() - LATE_AFTER_MINUTES * 60_000).toISOString()

    const { data, error } = await admin
      .from('blog_posts')
      .select('user_id,title,scheduled_for,schedule_mode,wordpress_url,wordpress_post_id')
      .not('scheduled_for', 'is', null)
      .lt('scheduled_for', cutoff)
      .is('published_at', null)
      .order('scheduled_for', { ascending: true })
      .limit(500)
    if (error) throw error

    type Row = {
      user_id: string; title: string | null; scheduled_for: string
      schedule_mode: string | null; wordpress_url: string | null; wordpress_post_id: number | null
    }
    const rows = (data ?? []) as Row[]

    const byUser = new Map<string, {
      userId: string; email: string | null; mode: string
      late: number; oldestDue: string; newestDue: string; sample: string[]
    }>()

    for (const r of rows) {
      const mode = r.schedule_mode ?? 'unknown'
      const key = `${r.user_id}::${mode}`
      const cur = byUser.get(key)
      if (!cur) {
        byUser.set(key, {
          userId: r.user_id, email: null, mode,
          late: 1, oldestDue: r.scheduled_for, newestDue: r.scheduled_for,
          sample: [r.title ?? 'Untitled'],
        })
        continue
      }
      cur.late++
      if (r.scheduled_for < cur.oldestDue) cur.oldestDue = r.scheduled_for
      if (r.scheduled_for > cur.newestDue) cur.newestDue = r.scheduled_for
      if (cur.sample.length < 3) cur.sample.push(r.title ?? 'Untitled')
    }

    // Best effort: the counts stand on their own if this fails.
    try {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
      const emails: Record<string, string> = {}
      for (const u of (list?.users ?? []) as Array<{ id: string; email?: string }>) {
        if (u.email) emails[u.id] = u.email
      }
      for (const v of byUser.values()) v.email = emails[v.userId] ?? null
    } catch { /* counts still stand */ }

    const groups = Array.from(byUser.values()).sort((a, b) => b.late - a.late)
    const total = groups.reduce((n, g) => n + g.late, 0)
    const wpNative = groups.filter(g => g.mode === 'wp-native').reduce((n, g) => n + g.late, 0)
    const ours = total - wpNative

    return NextResponse.json({
      ok: true,
      total,
      wpNative,
      ours,
      lateAfterMinutes: LATE_AFTER_MINUTES,
      groups,
      // Never one number for two different problems. A late wp-native post is
      // the creator's wp-cron not firing; a late draft-flip post is ours.
      headline: total === 0
        ? 'No scheduled post is past its time.'
        : `${total} scheduled post${total === 1 ? '' : 's'} went past their time with no publish recorded.`,
      split: total === 0 ? null
        : `${wpNative} of them are wp-native, which WordPress publishes with its own cron, and ${ours} are ours to flip.`,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'lookup failed' }, { status: 500 })
  }
}
