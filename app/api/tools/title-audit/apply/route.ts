/**
 * POST /api/tools/title-audit/apply
 *
 * Applies a corrected title to a single post (WP + blog_posts).
 * Body: { postId: string, newTitle: string }
 *
 * Slug stays unchanged — preserves any existing inbound links / RSS
 * subscribers. Only the displayed H1 + post_title field gets updated.
 *
 * Access: Creator+ (trial blocked). Only updates the caller's own
 * post (filtered by user_id) so users can't touch each other's
 * content. Opened from admin-only 2026-06-07.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { isStalePostError, WP_STALE_POST_MESSAGE } from '@/lib/wp-errors'
import { normalizeTier, type Tier } from '@/lib/tier'
import { getAuthAndOwner } from '@/lib/agency-auth'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    // 2026-06-09 Phase 2 (VA): title fix applies to owner's post + WP.
    const auth = await getAuthAndOwner(supabase)
    if (auth.error) return auth.error
    const { ownerId } = auth

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations').select('tier').eq('user_id', ownerId).maybeSingle()
    const tier = normalizeTier((tierRow?.tier as Tier) ?? 'trial')
    if (tier === 'trial') {
      return NextResponse.json(
        { error: 'Upgrade to Creator or higher to apply title fixes.' },
        { status: 403 },
      )
    }

    const { postId, newTitle } = await request.json() as { postId?: string; newTitle?: string }
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
    if (!newTitle || newTitle.trim().length < 5) {
      return NextResponse.json({ error: 'newTitle required (min 5 chars)' }, { status: 400 })
    }
    if (newTitle.length > 200) {
      return NextResponse.json({ error: 'newTitle too long (max 200)' }, { status: 400 })
    }

    // Pull the post — verify ownership and get wp_post_id + site_id.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: post } = await supabase
      .from('blog_posts')
      .select('id,wordpress_post_id,wordpress_site_id')
      .eq('id', postId)
      .eq('user_id', ownerId)
      .maybeSingle()
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    // Update WP first — if this fails, abort so the DB doesn't drift
    // out of sync with the live site.
    if (post.wordpress_post_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const siteId = (post as Record<string, unknown>).wordpress_site_id as string | null | undefined
      const creds = await getWordPressCredentials(supabase, ownerId, siteId ?? null)
      if (!creds) return NextResponse.json({ error: 'WordPress credentials not found' }, { status: 500 })
      const wp = createWordPressService(creds.wordpress_url, creds.wordpress_username, creds.wordpress_app_password, creds.wordpress_api_token ?? undefined)
      try {
        await wp.updatePost(post.wordpress_post_id, { title: newTitle.trim() })
      } catch (e) {
        if (isStalePostError(e)) return NextResponse.json({ error: WP_STALE_POST_MESSAGE, code: 'wp_post_deleted' }, { status: 410 })
        return NextResponse.json({ error: `WP update failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
      }
    }

    // Update DB.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase as any)
      .from('blog_posts')
      .update({ title: newTitle.trim() })
      .eq('id', postId)
      .eq('user_id', ownerId)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
