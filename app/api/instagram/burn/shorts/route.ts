/**
 * GET /api/instagram/burn/shorts
 *
 * Lists the signed-in creator's vertical YouTube Shorts so the Shop Burner
 * can show a "pick a Short" gallery (instead of every Short living under the
 * Blog Post Generator, which doesn't make a blog). Newest first, capped.
 *
 * `hasVideo` = the Short's vertical MP4 is already stored (instagram_video_url)
 * → the burner loads it instantly. Otherwise the burner links the creator out
 * to download it from YouTube and upload once (YouTube ToS: no server pull).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb
    .from('youtube_videos')
    .select('id,title,thumbnail_url,view_count,published_at,product_url,instagram_video_url,youtube_video_id,tiktok_posted_at,instagram_posted_at')
    .eq('user_id', user.id)
    .eq('is_vertical', true)
    .order('published_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shorts = ((data ?? []) as any[]).map((v) => ({
    id: v.id as string,
    title: (v.title as string) || '',
    thumbnailUrl: (v.thumbnail_url as string | null) || null,
    views: (v.view_count as number | null) ?? null,
    productUrl: (v.product_url as string | null) || null,
    hasVideo: !!v.instagram_video_url,
    youtubeVideoId: (v.youtube_video_id as string | null) || null,
    posted: !!(v.tiktok_posted_at || v.instagram_posted_at),
  }))
  return NextResponse.json({ shorts })
}
