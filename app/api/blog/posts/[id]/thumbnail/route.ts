// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/blog/posts/[id]/thumbnail — rebuild one post's featured image.
//
// WHY THIS EXISTS. A creator reported a thumbnail whose headline was
// misspelled and asked whether there was a way to regenerate it. There was
// not: the only route to a new thumbnail was ticking "Update my post thumbnail
// with Art Director" and rewriting the whole article, which rewrites text that
// was already fine and costs a generation to fix an image.
//
// THE SAME BUILDER THE REWRITE USES, from lib/blog-hero. A second copy would
// have been two paths agreeing about the cap, the product lookup and the
// upload right up until one of them learned something.
//
// IT CHANGES ONE THING. The article, the title, the links and the in-body
// images are not touched, and every failure leaves the existing thumbnail
// exactly where it is: a post with the wrong image beats a post with none.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { rebuildPostHero, heroOutcomeMessage } from '@/lib/blog-hero'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  // TWO KINDS OF ID REACH THIS, because the row toolbars carry whichever one
  // they have: the blog_posts uuid on the Library tab, and the WordPress
  // numeric id on the Posts tab. Accepting only the first would make the
  // button work on one tab and fail on the other for no reason a creator could
  // see, which is the same trap ChangeThumbnailButton already documents.
  const COLS = 'id,title,slug,video_id,wordpress_post_id,wordpress_site_id,wordpress_url'
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const { data: post } = isUuid
    ? await sb.from('blog_posts').select(COLS).eq('id', id).eq('user_id', user.id).maybeSingle()
    : await sb.from('blog_posts').select(COLS)
        .eq('wordpress_post_id', Number(id)).eq('user_id', user.id).maybeSingle()
  if (!post) {
    return NextResponse.json({
      error: 'MVP has no record of this post, so it cannot tell which blog it belongs to or what product it is about.',
    }, { status: 404 })
  }
  // A POST THAT WAS NEVER PUBLISHED HAS NOTHING TO SET AN IMAGE ON, and saying
  // so is better than a generation that succeeds and lands nowhere.
  if (!post.wordpress_post_id) {
    return NextResponse.json({
      error: 'This post is not on WordPress yet, so there is no thumbnail to replace.',
    }, { status: 409 })
  }

  const site = await getWordPressCredentials(supabase, user.id, post.wordpress_site_id ?? null)
  if (!site) {
    return NextResponse.json({
      error: 'WordPress is not connected. Add your credentials in Settings and try again.',
    }, { status: 400 })
  }

  // The video carries the product photo the designed thumbnail is built from.
  const { data: video } = post.video_id
    ? await sb.from('youtube_videos')
        .select('id,title,description,asin,product_image_url')
        .eq('id', post.video_id).eq('user_id', user.id).maybeSingle()
    : { data: null }

  const { data: integ } = await sb.from('integrations')
    .select('tier,subscription_period_start,subscription_period_end')
    .eq('user_id', user.id).maybeSingle()

  const wpService = createWordPressService(
    site.wordpress_url,
    site.wordpress_username,
    site.wordpress_app_password,
    site.wordpress_api_token || undefined,
  )

  const outcome = await rebuildPostHero({
    supabase, wpService,
    userId: user.id,
    tier: (integ?.tier as string | null) ?? null,
    wpPostId: Number(post.wordpress_post_id),
    video,
    description: (video?.description as string | null) ?? null,
    asin: (video?.asin as string | null) ?? null,
    wordpressUrl: site.wordpress_url ?? null,
    fallbackTitle: (post.title as string) || 'this post',
    slug: (post.slug as string) || String(post.id).slice(0, 8),
    periodStart: (integ?.subscription_period_start as string | null) ?? null,
    periodEnd: (integ?.subscription_period_end as string | null) ?? null,
    traceTag: `[rebuild-thumb:${String(post.id).slice(0, 8)}]`,
  })

  // THE OUTCOME IN WORDS, and a 200 only when something actually changed. A
  // success shape over a thumbnail that was not replaced is the plan reported
  // as the result, which is the failure this codebase keeps re-finding.
  if (!outcome.ok) {
    return NextResponse.json(
      { ok: false, reason: outcome.reason, error: heroOutcomeMessage(outcome) },
      { status: outcome.reason === 'over_cap' ? 429 : 502 },
    )
  }
  return NextResponse.json({
    ok: true,
    imageUrl: outcome.imageUrl,
    message: heroOutcomeMessage(outcome),
  })
}
