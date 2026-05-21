/**
 * POST /api/blog/pinterest-post
 * Publishes a pin from assets the user reviewed in the preview modal.
 * Publish logic is shared via lib/pin-publish.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { publishPinForPost, PinPublishError } from '@/lib/pin-publish'
import { readSocialCount, incrementSocialCount, evaluateSocialCap, SOCIAL_CAP } from '@/lib/social-cap'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tierRow } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).single()
  const tier = (tierRow?.tier as Tier) ?? 'trial'
  if (!tierAllowsSocial(tier, 'pinterest')) {
    return NextResponse.json(
      { error: 'Pinterest auto-publish is a Growth plan feature. Upgrade to Growth or Pro to pin to Pinterest.' },
      { status: 403 },
    )
  }

  const { postId, title, description, imageBase64, mediaType, fallbackImageUrl } = await request.json()
  if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
  if (!description) return NextResponse.json({ error: 'description required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: post }, { data: integration }] = await Promise.all([
    (supabase as any).from('blog_posts').select('id,title,wordpress_url,wordpress_post_id,social_publish_counts').eq('id', postId).single(),
    (supabase as any).from('integrations').select('pinterest_access_token,pinterest_board_id,wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token').eq('user_id', user.id).single(),
  ])
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

  const pinSocialCount = readSocialCount(post, 'pinterest')
  const pinCap = evaluateSocialCap(pinSocialCount)
  if (pinCap.exceeded) {
    return NextResponse.json({
      error: `You've published this post to Pinterest ${SOCIAL_CAP} times — that's the per-post cap on re-publishing. Edit the post or use a different post.`,
      socialCapReached: true,
      platform: 'pinterest',
    }, { status: 429 })
  }

  try {
    const { pinId } = await publishPinForPost({
      p: post, ig: integration, title, description, imageBase64, mediaType, fallbackImageUrl,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('blog_posts').update({ pinterest_pin_id: pinId }).eq('id', postId)
    await incrementSocialCount(supabase, postId, 'pinterest')
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
