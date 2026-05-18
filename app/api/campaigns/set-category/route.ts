/**
 * POST /api/campaigns/set-category
 *
 * Manual category override for a campaign post. Persists the pick on
 * the campaigns row and, if the post is already published, pushes the
 * change to the live WordPress post (creating the category if needed).
 *
 * Body: { campaignId: string, category: string }   ('' clears it)
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'

const GENERIC = /^(blog|uncategorized|general|news|misc|other|posts?)$/i

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { campaignId, category } = await request.json() as { campaignId?: string; category?: string | null }
    if (!campaignId) return NextResponse.json({ error: 'campaignId required' }, { status: 400 })

    const normalized = (category ?? '').trim() || null
    if (normalized && GENERIC.test(normalized)) {
      return NextResponse.json({ error: `"${normalized}" isn't a usable category — pick a real one.` }, { status: 400 })
    }
    if (normalized && normalized.length > 60) {
      return NextResponse.json({ error: 'Category name too long (60 char max)' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: campaign } = await (supabase as any)
      .from('campaigns')
      .select('id,blog_post_id')
      .eq('id', campaignId)
      .eq('user_id', user.id)
      .single()
    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updErr } = await (supabase as any)
      .from('campaigns')
      .update({ category: normalized, updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('user_id', user.id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    if (!normalized || !campaign.blog_post_id) {
      return NextResponse.json({ ok: true, pushedToWp: false })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: post } = await (supabase as any)
      .from('blog_posts')
      .select('wordpress_post_id')
      .eq('id', campaign.blog_post_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!post?.wordpress_post_id) {
      return NextResponse.json({ ok: true, pushedToWp: false, reason: 'no_published_post' })
    }

    const { data: wp } = await supabase
      .from('integrations')
      .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = wp as any
    if (!w?.wordpress_url) {
      return NextResponse.json({ ok: true, pushedToWp: false, warning: 'Saved, but WordPress not connected.' })
    }

    try {
      const wpService = createWordPressService(
        w.wordpress_url, w.wordpress_username, w.wordpress_app_password, w.wordpress_api_token || undefined,
      )
      const catId = await wpService.createCategory(normalized)
      await wpService.updatePost(post.wordpress_post_id, { categories: [catId] })
      return NextResponse.json({ ok: true, pushedToWp: true, category: normalized })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'WordPress update failed'
      return NextResponse.json({ ok: true, pushedToWp: false, warning: `Saved locally but WordPress update failed: ${msg}` })
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
