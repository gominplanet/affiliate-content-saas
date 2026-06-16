/**
 * GET /api/notifications
 *
 * Returns the user's recent activity from the past 7 days (scheduled-post
 * results — completed + failed — PLUS answered-but-unseen support tickets),
 * sorted newest-first. Powers the bell dropdown in the dashboard topbar —
 * surfaces "your LinkedIn fired at 9:05, your Threads failed because the token
 * expired, your help ticket was answered" without forcing the user to keep a
 * toast open.
 *
 * Returns: { events: NotificationEvent[] }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export interface NotificationEvent {
  id: string
  kind: 'social' | 'blog_publish' | 'support'
  platform: string | null
  status: 'completed' | 'failed'
  blog_post_title: string | null
  blog_post_url: string | null
  scheduled_at: string
  updated_at: string
  error_message: string | null
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()

  // Both halves of the bell are independent reads — fire them together so the
  // poll is one round-trip of latency, not two. The scheduled-posts select uses
  // an `as any` cast because the generated types don't yet know migration 103's
  // `kind` column. The support_tickets read is best-effort (a pre-migration-126
  // DB must not break the bell), so its failure resolves to empty, not a throw.
  const [scheduledRes, ticketsRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('scheduled_posts')
      .select('id,kind,platform,status,scheduled_at,updated_at,error_message,blog_posts(title,wordpress_url)')
      .eq('user_id', user.id)
      .in('status', ['completed', 'failed'])
      .gte('updated_at', weekAgo)
      .order('updated_at', { ascending: false })
      .limit(20),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('support_tickets')
      .select('id,subject,responded_at')
      .eq('user_id', user.id)
      .eq('status', 'answered')
      .eq('response_seen', false)
      .gte('responded_at', weekAgo)
      .order('responded_at', { ascending: false })
      .limit(20)
      .then((r: { data: unknown }) => r, () => ({ data: null })),
  ])
  const { data, error } = scheduledRes

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const events: NotificationEvent[] = ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
    id: r.id as string,
    // Defensive: synthesize kind from platform if column missing.
    kind: ((r.kind as 'social' | 'blog_publish' | undefined) ?? (r.platform == null ? 'blog_publish' : 'social')),
    platform: (r.platform as string | null) ?? null,
    status: r.status as 'completed' | 'failed',
    blog_post_title: ((r.blog_posts as { title?: string } | null)?.title as string | null) ?? null,
    blog_post_url: ((r.blog_posts as { wordpress_url?: string } | null)?.wordpress_url as string | null) ?? null,
    scheduled_at: r.scheduled_at as string,
    updated_at: r.updated_at as string,
    error_message: (r.error_message as string | null) ?? null,
  }))

  // Answered help tickets the user hasn't opened yet (cleared when they visit
  // /support), from the parallel read above. Merge + re-sort newest first,
  // then cap to 20. A missing support_tickets table resolved to data:null.
  const tickets = (ticketsRes as { data: unknown }).data
  for (const t of (tickets ?? []) as Array<Record<string, unknown>>) {
    events.push({
      id: `support_${t.id as string}`,
      kind: 'support',
      platform: null,
      status: 'completed',
      blog_post_title: (t.subject as string | null) ?? 'Your ticket',
      blog_post_url: '/support',
      scheduled_at: (t.responded_at as string) ?? new Date().toISOString(),
      updated_at: (t.responded_at as string) ?? new Date().toISOString(),
      error_message: null,
    })
  }

  events.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  return NextResponse.json({ events: events.slice(0, 20) })
}
