import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'

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

    const { data: wpRow } = await supabase
      .from('integrations')
      .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wp = wpRow as any

    // Resolve the WP post ID to delete
    let resolvedWpPostId: number | null = wpPostId ?? null

    if (postId && !resolvedWpPostId) {
      const { data: postRow } = await supabase
        .from('blog_posts')
        .select('wordpress_post_id')
        .eq('id', postId)
        .eq('user_id', user.id)
        .single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolvedWpPostId = (postRow as any)?.wordpress_post_id ?? null
    }

    // Delete from WordPress
    if (wp?.wordpress_url && resolvedWpPostId) {
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
