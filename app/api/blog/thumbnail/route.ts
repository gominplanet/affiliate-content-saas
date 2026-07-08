// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/blog/thumbnail  { postId, image }
//
// Change the hero/featured image of an ALREADY-PUBLISHED post, from anywhere in
// MVP (the Manual-edit expander). Works for any post — video-backed, link-based,
// or manually created — because it sets the image directly on the live
// WordPress post (featured_media), independent of how the post was made.
//
// Uploads through the WP service (proxy-first, so it survives the host WAFs that
// block a direct wp-admin media upload), then points the post's featured image
// at the new media. `postId` may be the blog_posts UUID or the WP numeric id.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { isStalePostError, WP_STALE_POST_MESSAGE } from '@/lib/wp-errors'

export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { postId, image } = await request.json().catch(() => ({})) as { postId?: string; image?: string }
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec((image || '').trim())
    if (!m) return NextResponse.json({ error: 'Please choose an image file.' }, { status: 400 })
    const mime = m[1]
    const b64 = m[2]
    if (Buffer.byteLength(b64, 'base64') > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'That image is too large (max 10MB).' }, { status: 400 })
    }

    // postId may be the blog_posts UUID or the WordPress numeric id (link posts).
    const byWpId = /^\d+$/.test(postId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: post } = await (supabase as any)
      .from('blog_posts')
      .select('id, wordpress_post_id, wordpress_site_id')
      .eq(byWpId ? 'wordpress_post_id' : 'id', byWpId ? Number(postId) : postId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    const wpPostId = post.wordpress_post_id as number | null
    if (!wpPostId) return NextResponse.json({ error: 'This post isn’t linked to a WordPress post yet, so there’s no thumbnail to change.' }, { status: 400 })

    const site = await getWordPressCredentials(supabase, user.id, post.wordpress_site_id ?? null)
    if (!site) return NextResponse.json({ error: 'WordPress isn’t connected — reconnect it in Setup, then try again.' }, { status: 400 })

    const wp = createWordPressService(
      site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined,
    )

    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg'
    try {
      const media = await wp.uploadImageFromBase64(b64, `thumbnail-${wpPostId}.${ext}`, mime)
      if (!media?.id) return NextResponse.json({ error: 'The image uploaded but WordPress returned no media id — try again.' }, { status: 502 })
      await wp.updatePost(wpPostId, { featured_media: media.id })
      try { await wp.purgeCache() } catch { /* non-fatal */ }
      return NextResponse.json({ ok: true, url: media.source_url ?? null })
    } catch (err) {
      if (isStalePostError(err)) return NextResponse.json({ error: WP_STALE_POST_MESSAGE }, { status: 409 })
      return NextResponse.json({ error: `Couldn’t set the thumbnail: ${err instanceof Error ? err.message : 'unknown error'}` }, { status: 502 })
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
