// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/blog/thumbnail  { postId, image, postUrl? }
//
// Change the hero/featured image of an ALREADY-PUBLISHED post, from anywhere in
// MVP (the Manual-edit expander). Works for any post — video-backed, link-based,
// or manually created — because it sets the image directly on the live
// WordPress post (featured_media), independent of how the post was made.
//
// Uploads through the WP service (proxy-first, so it survives the host WAFs that
// block a direct wp-admin media upload), then points the post's featured image
// at the new media. `postId` may be the blog_posts UUID or the WP numeric id.
//
// It used to answer "Post not found" whenever blog_posts had no row, which is
// the wrong noun: the post is live, visible in the Posts tab, and the creator is
// looking at it. What was missing was MVP's RECORD of it — a buying guide whose
// row insert failed after the WordPress publish, a rebuild that minted a new WP
// id. Changing a featured image needs the WP post id and that site's
// credentials; the row is a convenience. So an untracked post is now handled
// rather than refused, guarded by a host check so a bare numeric id can never
// land on the wrong blog. See lib/wp-post-target.ts.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials, listSites } from '@/lib/wordpress-sites'
import { isStalePostError, WP_STALE_POST_MESSAGE } from '@/lib/wp-errors'
import {
  resolveWpPostTarget, confirmUntrackedSite, describeUnresolvedTarget, classifyPostRef,
} from '@/lib/wp-post-target'

export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { postId, image, postUrl } = await request.json().catch(() => ({})) as { postId?: string; image?: string; postUrl?: string | null }
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec((image || '').trim())
    if (!m) return NextResponse.json({ error: 'Please choose an image file.' }, { status: 400 })
    const mime = m[1]
    const b64 = m[2]
    if (Buffer.byteLength(b64, 'base64') > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'That image is too large (max 10MB).' }, { status: 400 })
    }

    // postId may be the blog_posts UUID or the WordPress numeric id (link posts,
    // guides, comparisons — every row in the Posts tab). postUrl is the live
    // permalink, which resolves a post whose WP id drifted and, for a post MVP
    // never recorded, proves which blog it is on.
    const target = await resolveWpPostTarget(supabase, user.id, postId, postUrl, listSites)

    if (!target.wpPostId) {
      // Nothing actionable. Say which half is missing rather than "not found".
      if (!target.untracked) {
        return NextResponse.json({ error: 'This post isn’t linked to a WordPress post yet, so there’s no thumbnail to change.' }, { status: 400 })
      }
      return NextResponse.json({ error: describeUnresolvedTarget(classifyPostRef(postId).kind, !!postUrl) }, { status: 404 })
    }
    const wpPostId = target.wpPostId

    const site = await getWordPressCredentials(supabase, user.id, target.siteId)
    if (!site) return NextResponse.json({ error: 'WordPress isn’t connected — reconnect it in Setup, then try again.' }, { status: 400 })

    // An untracked post is a bare number until the host confirms the blog. Post
    // 1234 exists on every WordPress install; writing to the wrong one replaces
    // a stranger's hero image with this creator's.
    const wrongSite = confirmUntrackedSite(target, postUrl, site.wordpress_url)
    if (wrongSite) return NextResponse.json({ error: wrongSite }, { status: 409 })

    const wp = createWordPressService(
      site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined,
    )

    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg'
    try {
      const media = await wp.uploadImageFromBase64(b64, `thumbnail-${wpPostId}.${ext}`, mime)
      if (!media?.id) return NextResponse.json({ error: 'The image uploaded but WordPress returned no media id — try again.' }, { status: 502 })
      await wp.updatePost(wpPostId, { featured_media: media.id })
      try { await wp.purgeCache() } catch { /* non-fatal */ }
      // `tracked` is reported because it is a real, visible difference: the
      // image changed on the live site, but MVP still has no row for this post,
      // so the Library, Rebuild and the social pills will keep behaving as if
      // it isn't there. The caller says so instead of a bare success.
      return NextResponse.json({ ok: true, url: media.source_url ?? null, tracked: !target.untracked, via: target.via })
    } catch (err) {
      if (isStalePostError(err)) return NextResponse.json({ error: WP_STALE_POST_MESSAGE }, { status: 409 })
      return NextResponse.json({ error: `Couldn’t set the thumbnail: ${err instanceof Error ? err.message : 'unknown error'}` }, { status: 502 })
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
