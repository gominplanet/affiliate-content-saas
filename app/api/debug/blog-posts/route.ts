import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('blog_posts')
    .select('id,slug,wordpress_url,wordpress_post_id,video_id,title')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  type Row = { slug: string | null; wordpress_url: string | null; wordpress_post_id: number | null; video_id: string | null; title: string }
  const withVideo = (data ?? []).filter((p: Row) => p.video_id)
  const withoutVideo = (data ?? []).filter((p: Row) => !p.video_id)

  return NextResponse.json({
    total: (data ?? []).length,
    withVideo: withVideo.length,
    withoutVideo: withoutVideo.length,
    sampleWithout: withoutVideo.slice(0, 10).map((p: Row) => ({
      slug: p.slug,
      wordpress_url: p.wordpress_url,
      wordpress_post_id: p.wordpress_post_id,
      title: p.title?.slice(0, 60),
    })),
  })
}
