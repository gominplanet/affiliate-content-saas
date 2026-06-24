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

  // `kind` + `parent_id` were added in migration 103. We select them with
  // an `as any` cast to bypass the supabase-generated types until the
  // codegen step runs. The UI uses kind='blog_publish' to render those
  // rows as the "WP publish" entry above their child social rows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // video_id + youtube_videos join (migration 138) give vertical Short-direct
  // rows a title. Try the richer select first; if the columns aren't there yet
  // (pre-138 DB), fall back to the original so the list keeps working.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { data, error } = await (supabase as any)
    .from('scheduled_posts')
    .select('id,blog_post_id,video_id,kind,parent_id,platform,scheduled_at,body_text,status,attempts,error_message,external_id,created_at,blog_posts(title,wordpress_url),youtube_videos(title)')
    .eq('user_id', user.id)
    .order('scheduled_at', { ascending: true })
    .limit(100)
  if (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fb = await (supabase as any)
      .from('scheduled_posts')
      .select('id,blog_post_id,kind,parent_id,platform,scheduled_at,body_text,status,attempts,error_message,external_id,created_at,blog_posts(title,wordpress_url)')
      .eq('user_id', user.id)
      .order('scheduled_at', { ascending: true })
      .limit(100)
    data = fb.data; error = fb.error
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ scheduled: data ?? [] })
}
