/**
 * POST /api/blog/pinterest-post
 * Publishes a pin from assets the user reviewed in the preview modal.
 * Publish logic is shared via lib/pin-publish.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { publishPinForPost, PinPublishError } from '@/lib/pin-publish'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { readSocialCount, incrementSocialCount, evaluateSocialCap, SOCIAL_CAP } from '@/lib/social-cap'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { resolveBlogPostId } from '@/lib/resolve-post-id'
import { recordSocialPermalink } from '@/lib/social-permalink'
import { socialPermalink } from '@/lib/brand-recap'
import { syntheticWpPost } from '@/lib/wp-post-fallback'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tierRow } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).single()
  const tier = (tierRow?.tier as Tier) ?? 'trial'
  if (!tierAllowsSocial(tier, 'pinterest')) {
    return NextResponse.json(
      { error: 'Pinterest auto-publish is a Studio plan feature. Upgrade to Studio or Pro to pin to Pinterest.' },
      { status: 403 },
    )
  }

  const { postId: rawPostId, title, description, imageBase64, mediaType, fallbackImageUrl, postUrl } = await request.json()
  if (!rawPostId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
  if (!description) return NextResponse.json({ error: 'description required' }, { status: 400 })
  // Video-less rows send the WordPress post id — resolve to the blog_posts UUID.
  const postId = (await resolveBlogPostId(supabase, user.id, rawPostId, postUrl)) || rawPostId

  // .maybeSingle so a missing row → null (WordPress-only post falls through to
  // the synthetic-post path) rather than erroring.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: post }, { data: integration }] = await Promise.all([
    supabase.from('blog_posts').select('id,title,wordpress_url,wordpress_post_id,wordpress_site_id,social_publish_counts').eq('id', postId).maybeSingle(),
    supabase.from('integrations').select('pinterest_access_token,pinterest_board_id,pinterest_fallback_board').eq('user_id', user.id).single(),
  ])
  // No MVP record → pin straight from the WordPress post. `hasRow` gates the
  // post-publish DB writes (there's no row to persist pin id / cap counts on).
  const hasRow = !!post
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let p: any = post
  if (!p) {
    if (!postUrl) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    p = syntheticWpPost({ wpPostId: rawPostId, url: postUrl, title, image: fallbackImageUrl })
  }

  // Multi-site: resolve WP credentials for the SAME site the post lives on
  // so the Pinterest pin's category-board lookup hits the right WP install.
  const wpSite = await getWordPressCredentials(
    supabase,
    user.id,
    (p as { wordpress_site_id?: string | null }).wordpress_site_id,
  )

  const pinSocialCount = readSocialCount(p, 'pinterest')
  const pinCap = evaluateSocialCap(pinSocialCount)
  if (pinCap.exceeded) {
    return NextResponse.json({
      error: `You've published this post to Pinterest ${SOCIAL_CAP} times — that's the per-post cap on re-publishing. Edit the post or use a different post.`,
      socialCapReached: true,
      platform: 'pinterest',
    }, { status: 429 })
  }

  try {
    // Decrypt the integrations row before handing it to publishPinForPost
    // (2026-06-02 rollout — the pin lib reads pinterest_access_token raw).
    const { pinId } = await publishPinForPost({
      p, ig: decryptIntegrationRow(integration), site: wpSite, title, description, imageBase64, mediaType, fallbackImageUrl,
    })
    // Persist pin id + bump the per-post cap counter — only when there's a real
    // blog_posts row (a synthetic WP-only post has no id to write to).
    if (hasRow) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await supabase.from('blog_posts').update({ pinterest_pin_id: pinId }).eq('id', postId)
      // Record the canonical pin URL so the brand-recap links straight to it.
      await recordSocialPermalink(supabase, postId, 'pinterest', socialPermalink.pinterest(pinId))
      await incrementSocialCount(supabase, postId, 'pinterest')
    }
    return NextResponse.json({
      ok: true,
      pinId,
      publishCount: pinSocialCount + 1,
      isLastAllowed: pinCap.willBeLast,
    })
  } catch (e) {
    if (e instanceof PinPublishError) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Pinterest pin failed' }, { status: 500 })
  }
}
