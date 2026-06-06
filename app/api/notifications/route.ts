/**
 * GET /api/notifications
 *
 * Returns the user's last 20 scheduled-post events from the past 7 days
 * (completed + failed, sorted newest-first). Powers the bell dropdown in
 * the dashboard topbar — surfaces "your LinkedIn fired at 9:05, your
 * Threads failed because the token expired" without forcing the user to
 * keep the Schedule modal's toast open during the 30-60s gen.
 *
 * Returns: { events: NotificationEvent[] }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export interface NotificationEvent {
  id: string
  kind: 'social' | 'blog_publish'
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

  // Pull recent events + join blog_posts for title/url. The select uses
  // an `as any` cast because the supabase-generated types don't yet know
  // about migration 103's `kind` column. Drop after `gen types` runs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('scheduled_posts')
    .select('id,kind,platform,status,scheduled_at,updated_at,error_message,blog_posts(title,wordpress_url)')
    .eq('user_id', user.id)
    .in('status', ['completed', 'failed'])
    .gte('updated_at', weekAgo)
    .order('updated_at', { ascending: false })
    .limit(20)

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

  return NextResponse.json({ events })
}
