/**
 * GET /api/blog/tiktok-post/my-renders
 *
 * Lists the user's existing vertical (9:16) video renders — any youtube_videos
 * row that already has an instagram_video_url. Powers the "Use one you already
 * made" picker on the TikTok/IG publish screens so repeat users can attach a
 * render they've already uploaded or burned, instead of uploading again.
 *
 * Returns: { renders: Array<{ videoId, title, thumbnailUrl, videoUrl }> }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('youtube_videos')
    .select('id,title,youtube_video_id,instagram_video_url,created_at')
    .eq('user_id', user.id)
    .not('instagram_video_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(40)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renders = ((data as any[]) || [])
    .filter(r => typeof r.instagram_video_url === 'string' && /^https?:\/\//.test(r.instagram_video_url))
    .map(r => ({
      videoId: r.id as string,
      title: (r.title as string) || 'Untitled',
      thumbnailUrl: r.youtube_video_id ? `https://i.ytimg.com/vi/${r.youtube_video_id}/hqdefault.jpg` : null,
      videoUrl: r.instagram_video_url as string,
    }))

  return NextResponse.json({ renders })
}
