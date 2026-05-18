/**
 * DELETE /api/campaigns/delete
 *
 * Removes a campaign post end-to-end: the WordPress post, the linked
 * blog_posts row (which powers the social pills), and the campaigns row
 * itself. Mirrors /api/blog/delete but also clears the campaign tracking
 * row so the list reflects reality.
 *
 * Body: { campaignId }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'

export async function DELETE(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const campaignId = body.campaignId as string | undefined
    if (!campaignId) {
      return NextResponse.json({ error: 'campaignId required' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: campaign } = await (supabase as any)
      .from('campaigns')
      .select('id,blog_post_id')
      .eq('id', campaignId)
      .eq('user_id', user.id)
      .single()
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const blogPostId = campaign.blog_post_id as string | null

    // Resolve the WP post id from the linked blog_posts row
    let resolvedWpPostId: number | null = null
    if (blogPostId) {
      const { data: postRow } = await supabase
        .from('blog_posts')
        .select('wordpress_post_id')
        .eq('id', blogPostId)
        .eq('user_id', user.id)
        .single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolvedWpPostId = (postRow as any)?.wordpress_post_id ?? null
    }

    // Delete the live WordPress post (non-fatal — keep cleaning up locally)
    if (resolvedWpPostId) {
      const { data: wpRow } = await supabase
        .from('integrations')
        .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token')
        .eq('user_id', user.id)
        .single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wp = wpRow as any
      if (wp?.wordpress_url) {
        try {
          const wpService = createWordPressService(
            wp.wordpress_url,
            wp.wordpress_username,
            wp.wordpress_app_password,
            wp.wordpress_api_token || undefined,
          )
          await wpService.deletePost(resolvedWpPostId)
        } catch { /* non-fatal */ }
      }
    }

    if (blogPostId) {
      await supabase.from('blog_posts').delete().eq('id', blogPostId).eq('user_id', user.id)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('campaigns').delete().eq('id', campaignId).eq('user_id', user.id)

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
