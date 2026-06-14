/**
 * DELETE /api/campaigns/delete
 *
 * Removes a campaign post end-to-end: the WordPress post, the linked
 * blog_posts row (which powers the social pills), and the campaigns row.
 *
 * Uses the service-role client (scoped by user_id) on purpose: the
 * `campaigns` table has no DELETE RLS policy, so a user-scoped client
 * silently no-ops the campaign delete and the row reappears on refresh.
 *
 * WP post resolution: prefer blog_posts.wordpress_post_id; if the
 * campaign errored before blog_posts linked (blog_post_id null), fall
 * back to resolving the post id from the slug in wordpress_url so the
 * orphaned WP post still gets deleted.
 *
 * Body: { campaignId }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

function slugFromUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '')
    const seg = path.split('/').filter(Boolean).pop()
    return seg ? decodeURIComponent(seg) : null
  } catch {
    return null
  }
}

// Accept POST as an alias for DELETE. Some clients (and any cached older JS
// bundle) call this endpoint with POST; without this they'd 405. Same handler.
export async function POST(request: Request) {
  return DELETE(request)
}

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

    const admin = createAdminClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: campaign } = await admin
      .from('campaigns')
      .select('id,blog_post_id,wordpress_url')
      .eq('id', campaignId)
      .eq('user_id', user.id)
      .single()
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const blogPostId = campaign.blog_post_id as string | null

    // Resolve the WP post id: linked blog_posts row first, slug fallback.
    let resolvedWpPostId: number | null = null
    if (blogPostId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: postRow } = await admin
        .from('blog_posts')
        .select('wordpress_post_id')
        .eq('id', blogPostId)
        .eq('user_id', user.id)
        .single()
      resolvedWpPostId = postRow?.wordpress_post_id ?? null
    }

    // Decrypted creds via the canonical helper — reading integrations.* raw
    // hands an encrypted blob (enc:v1:…) to the write path. (Same bug fixed in
    // /api/campaigns/generate 2026-06-14.)
    const wp = await getWordPressCredentials(supabase, user.id)

    if (wp?.wordpress_url) {
      try {
        const wpService = createWordPressService(
          wp.wordpress_url,
          wp.wordpress_username,
          wp.wordpress_app_password,
          wp.wordpress_api_token || undefined,
        )
        if (!resolvedWpPostId) {
          const slug = slugFromUrl(campaign.wordpress_url as string | null)
          if (slug) resolvedWpPostId = await wpService.getPostIdBySlug(slug)
        }
        if (resolvedWpPostId) await wpService.deletePost(resolvedWpPostId)
      } catch { /* non-fatal — still clean up our rows */ }
    }

    if (blogPostId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await admin.from('blog_posts').delete().eq('id', blogPostId).eq('user_id', user.id)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: delErr } = await admin
      .from('campaigns')
      .delete()
      .eq('id', campaignId)
      .eq('user_id', user.id)
    if (delErr) {
      return NextResponse.json({ error: `Campaign delete failed: ${delErr.message}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
