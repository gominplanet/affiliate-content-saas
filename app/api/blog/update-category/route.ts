/**
 * POST /api/blog/update-category
 *
 * Updates the category for a single video — works before AND after the
 * blog post has been generated:
 *
 *   - Always persists the user's pick to youtube_videos.selected_category
 *     so the next generate uses it (or it stays current if already published).
 *   - If the video has a linked published WordPress post, also pushes the
 *     category change to WP via the REST API. Creates the category if it
 *     doesn't exist on the site yet.
 *
 * Body: { videoId: string, category: string }
 *   category = '' or null clears the override (next generate falls back to AI/niche).
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { videoId, category } = await request.json() as { videoId?: string; category?: string | null }
    if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 })

    const normalized = (category ?? '').trim() || null

    // 1. Persist on the youtube_videos row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateErr } = await supabase
      .from('youtube_videos')
      .update({ selected_category: normalized })
      .eq('id', videoId)
      .eq('user_id', user.id)
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    // 2. If the video has a published WP post and the user set (not cleared)
    //    a category, push the change to WP.
    if (!normalized) {
      return NextResponse.json({ ok: true, pushedToWp: false })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: post } = await supabase
      .from('blog_posts')
      .select('id,wordpress_post_id,wordpress_site_id')
      .eq('user_id', user.id)
      .eq('video_id', videoId)
      .limit(1)
      .maybeSingle()

    if (!post?.wordpress_post_id) {
      return NextResponse.json({ ok: true, pushedToWp: false, reason: 'no_published_post' })
    }

    // Multi-site: push the category change to the SAME site the post lives
    // on (not the user's default). Category names CAN diverge across sites
    // — a Wine site might call it "Cabernet" while Tech calls it "Laptops".
    const site = await getWordPressCredentials(
      supabase,
      user.id,
      (post as { wordpress_site_id?: string | null }).wordpress_site_id,
    )
    if (!site) {
      // DB updated but we can't reach WP — that's fine, next generate-side
      // sync will fix it. Surface as a warning.
      return NextResponse.json({ ok: true, pushedToWp: false, warning: 'WordPress not connected — category saved locally only.' })
    }

    const wpService = createWordPressService(
      site.wordpress_url,
      site.wordpress_username,
      site.wordpress_app_password,
      site.wordpress_api_token || undefined,
    )

    try {
      const catId = await wpService.createCategory(normalized)
      await wpService.updatePost(post.wordpress_post_id, { categories: [catId] })
      return NextResponse.json({ ok: true, pushedToWp: true, category: normalized })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'WordPress update failed'
      // Local save still succeeded, so partial success.
      return NextResponse.json({ ok: true, pushedToWp: false, warning: `Saved locally but WordPress update failed: ${msg}` })
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
