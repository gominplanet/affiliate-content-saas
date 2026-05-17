/**
 * GET /api/blog/scheduled-list
 *
 * Returns the user's pending scheduled social posts (oldest-due first),
 * plus the 20 most recent completed/failed ones for history.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('scheduled_posts')
    .select('id,blog_post_id,platform,scheduled_at,body_text,status,attempts,error_message,external_id,created_at,blog_posts(title,wordpress_url)')
    .eq('user_id', user.id)
    .order('scheduled_at', { ascending: true })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ scheduled: data ?? [] })
}
