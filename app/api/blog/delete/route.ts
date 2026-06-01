import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

export async function DELETE(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    // Accept either postId (Supabase UUID) or wpPostId (WP integer)
    const postId = body.postId as string | undefined
    const wpPostId = body.wpPostId as number | undefined

    if (!postId && !wpPostId) {
      return NextResponse.json({ error: 'postId or wpPostId required' }, { status: 400 })
    }

    // Resolve the WP post ID + which site it lives on (multi-site routing:
    // delete must hit the WP install that hosts the post, not the user's
    // current default). Pull both wordpress_post_id AND wordpress_site_id
    // when we have a Supabase UUID; the WP integer alone can't tell us
    // which site without an extra lookup.
    let resolvedWpPostId: number | null = wpPostId ?? null
    let resolvedSiteId: string | null = null

    if (postId) {
      const { data: postRow } = await supabase
        .from('blog_posts')
        .select('wordpress_post_id, wordpress_site_id')
        .eq('id', postId)
        .eq('user_id', user.id)
        .single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pr = postRow as any
      if (!resolvedWpPostId) resolvedWpPostId = pr?.wordpress_post_id ?? null
      resolvedSiteId = pr?.wordpress_site_id ?? null
    } else if (wpPostId) {
      // Caller only sent a WP integer — look up the row so we can find the
      // site. Same query, different key. We don't fail if no row matches
      // (orphan WP post on the user's blog); we just route to default site
      // below.
      const { data: postRow } = await supabase
        .from('blog_posts')
        .select('wordpress_site_id')
        .eq('wordpress_post_id', wpPostId)
        .eq('user_id', user.id)
        .maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolvedSiteId = (postRow as any)?.wordpress_site_id ?? null
    }

    // Multi-site: route the WP delete to the SAME site this post lives on.
    // resolvedSiteId null → default site (legacy posts pre-Phase-3).
    const site = await getWordPressCredentials(supabase, user.id, resolvedSiteId)

    // Delete from WordPress
    if (site && resolvedWpPostId) {
      try {
        const wpService = createWordPressService(
          site.wordpress_url,
          site.wordpress_username,
          site.wordpress_app_password,
          site.wordpress_api_token || undefined,
        )
        await wpService.deletePost(resolvedWpPostId)
      } catch { /* non-fatal */ }
    }

    // Remove from Supabase if we have a UUID
    if (postId) {
      await supabase.from('blog_posts').delete().eq('id', postId).eq('user_id', user.id)
    } else if (resolvedWpPostId) {
      // Also clean up by WP post ID in case it exists
      await supabase.from('blog_posts')
        .delete()
        .eq('wordpress_post_id', resolvedWpPostId)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
