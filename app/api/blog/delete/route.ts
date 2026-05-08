import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'

export async function DELETE(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { postId } = await request.json()
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    // Get the post + WP credentials
    const { data: postRow } = await supabase
      .from('blog_posts')
      .select('id,wordpress_post_id')
      .eq('id', postId)
      .eq('user_id', user.id)
      .single()

    if (!postRow) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const post = postRow as any

    const { data: wpRow } = await supabase
      .from('integrations')
      .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wp = wpRow as any

    // Delete from WordPress (best-effort)
    if (wp?.wordpress_url && post.wordpress_post_id) {
      try {
        const wpService = createWordPressService(
          wp.wordpress_url,
          wp.wordpress_username,
          wp.wordpress_app_password,
          wp.wordpress_api_token || undefined,
        )
        await wpService.deletePost(post.wordpress_post_id)
      } catch { /* non-fatal — still remove from our DB */ }
    }

    // Remove from our database
    await supabase.from('blog_posts').delete().eq('id', postId).eq('user_id', user.id)

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
