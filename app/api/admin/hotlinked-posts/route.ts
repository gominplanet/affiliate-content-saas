// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/hotlinked-posts
//
// Who still has published posts pointing at our image server, and is the sweep
// actually draining it.
//
// This exists because the number that mattered most today could only be got by
// pasting SQL into Supabase by hand:
//
//   610ad913   81 posts   oldest 26 Jun   newest 16 Sep
//   80822bd4   69 posts   oldest 12 Jul   newest 15 Sep
//   74efb4c7   23 posts   oldest 27 Jun   newest 10 Sep
//   f1d13171    7 posts   oldest  3 Aug   newest  7 Sep
//   9936ec62    4 posts   oldest 28 May   newest  2 Sep
//   d8f53815    2 posts   oldest 30 Jul   newest 11 Sep
//              186 posts, every one of them live on a site
//
// /api/cron/rehost-hotlinked now repairs these unattended, and its report goes
// to a Vercel log nobody reads. A repair whose only evidence is a log line is
// the same problem as the bug it fixes: it is invisible either way, working or
// not. This is the screen that says which.
//
// THE NEWEST COLUMN IS THE ONE TO WATCH. If the oldest date climbs while the
// newest stays today, the sweep is draining the backlog and the leak is still
// open, which is a different problem from the one the sweep solves.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Admin gate — same check as users-list.
    const { data: caller } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((caller as any)?.tier !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any

    const { data, error } = await admin
      .from('blog_posts')
      .select('user_id,created_at,wordpress_post_id')
      .ilike('content', '%fal.media%')
      .limit(5000)
    if (error) throw error

    const rows = (data ?? []) as Array<{ user_id: string; created_at: string; wordpress_post_id: number | null }>

    const byOwner = new Map<string, { ownerId: string; posts: number; liveOnSite: number; oldest: string; newest: string }>()
    for (const r of rows) {
      const cur = byOwner.get(r.user_id)
      if (!cur) {
        byOwner.set(r.user_id, {
          ownerId: r.user_id,
          posts: 1,
          liveOnSite: r.wordpress_post_id != null ? 1 : 0,
          oldest: r.created_at,
          newest: r.created_at,
        })
        continue
      }
      cur.posts++
      if (r.wordpress_post_id != null) cur.liveOnSite++
      if (r.created_at < cur.oldest) cur.oldest = r.created_at
      if (r.created_at > cur.newest) cur.newest = r.created_at
    }

    const owners = Array.from(byOwner.values()).sort((a, b) => b.posts - a.posts)

    // Put an email on each row so this is usable without a second lookup. Best
    // effort: a failure here must not take the counts down with it, since the
    // counts are the thing worth having.
    const emails: Record<string, string> = {}
    try {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
      for (const u of (list?.users ?? []) as Array<{ id: string; email?: string }>) {
        if (u.email) emails[u.id] = u.email
      }
    } catch { /* counts still stand on their own */ }

    const total = owners.reduce((n, o) => n + o.posts, 0)
    // Anything created in the last two days means the generator is still
    // producing these, which the sweep does not address and cannot.
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
    const stillArriving = owners.filter(o => o.newest >= twoDaysAgo)

    return NextResponse.json({
      ok: true,
      total,
      owners: owners.map(o => ({ ...o, email: emails[o.ownerId] ?? null })),
      // Said plainly rather than left for the reader to work out from dates.
      headline: total === 0
        ? 'No published posts are pointing at our image server.'
        : `${total} post${total === 1 ? '' : 's'} across ${owners.length} creator${owners.length === 1 ? '' : 's'} still point at our image server.`,
      leakOpen: stillArriving.length > 0,
      leakNote: stillArriving.length > 0
        ? `${stillArriving.length} of them published one in the last two days, so this is still being produced and not only a backlog. The sweep cannot fix that; their sites are refusing uploads.`
        : 'None in the last two days, so what is left is backlog rather than new arrivals.',
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'lookup failed' }, { status: 500 })
  }
}
