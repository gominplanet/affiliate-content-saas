import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendWeeklyDigest } from '@/lib/email'

export const maxDuration = 60

// Called by Vercel Cron every Monday at 9am UTC
// vercel.json: { "crons": [{ "path": "/api/cron/weekly-digest", "schedule": "0 9 * * 1" }] }
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Get all users with weekly_digest enabled
  const { data: integrations } = await supabase
    .from('integrations')
    .select('user_id, notification_preferences')

  if (!integrations?.length) return NextResponse.json({ sent: 0 })

  let sent = 0
  for (const row of integrations) {
    const prefs = row.notification_preferences ?? {}
    if (!prefs.weekly_digest) continue

    // Get user email from auth
    const { data: { user } } = await supabase.auth.admin.getUserById(row.user_id)
    if (!user?.email) continue

    // Posts this week
    const { data: recentPosts } = await supabase
      .from('blog_posts')
      .select('title')
      .eq('user_id', row.user_id)
      .gte('published_at', oneWeekAgo)
      .order('published_at', { ascending: false })

    // Total posts
    const { count: totalPosts } = await supabase
      .from('blog_posts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', row.user_id)

    // Total videos
    const { count: totalVideos } = await supabase
      .from('youtube_videos')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', row.user_id)

    await sendWeeklyDigest(user.email, {
      postsThisWeek: recentPosts?.length ?? 0,
      totalPosts: totalPosts ?? 0,
      totalVideos: totalVideos ?? 0,
      recentTitles: (recentPosts ?? []).slice(0, 5).map(p => p.title),
    })

    sent++
  }

  return NextResponse.json({ sent })
}
