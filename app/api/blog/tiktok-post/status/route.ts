/**
 * GET /api/blog/tiktok-post/status?blogPostId=… — check the TikTok publish
 * processing state for a single post.
 *
 * The publish screen polls this every ~5s after kicking off Direct Post
 * until status is PUBLISH_COMPLETE or FAILED. On COMPLETE we persist the
 * share URL + status so the Content page can render the "Open on TikTok"
 * link without re-polling.
 *
 * Polling cost: 1 TikTok API call per request, well under the documented
 * 6 req/min/user rate limit even with multiple browser tabs open.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getValidTikTokToken, pollPublishStatus } from '@/services/tiktok'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const blogPostId = (searchParams.get('blogPostId') || '').trim()
  if (!blogPostId) return NextResponse.json({ error: 'blogPostId is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: post } = await sb
    .from('blog_posts')
    .select('tiktok_publish_id,tiktok_publish_status,tiktok_share_url,tiktok_error_message')
    .eq('id', blogPostId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!post?.tiktok_publish_id) {
    return NextResponse.json({ error: 'No TikTok publish in progress for this post.' }, { status: 404 })
  }

  // If we already saw PUBLISH_COMPLETE / FAILED on a previous poll, short-
  // circuit — the row carries the final state.
  if (post.tiktok_publish_status === 'published' || post.tiktok_publish_status === 'failed') {
    return NextResponse.json({
      status: post.tiktok_publish_status,
      shareUrl: post.tiktok_share_url ?? null,
      errorMessage: post.tiktok_error_message ?? null,
    })
  }

  const token = await getValidTikTokToken(supabase, user.id)
  if (!token) {
    return NextResponse.json({
      error: 'TikTok token expired. Reconnect TikTok.',
      reconnectRequired: true,
    }, { status: 412 })
  }

  const result = await pollPublishStatus(token, post.tiktok_publish_id)

  // Persist whenever we land on a terminal state so subsequent polls are free.
  if (result.status === 'PUBLISH_COMPLETE') {
    await sb
      .from('blog_posts')
      .update({
        tiktok_publish_status: 'published',
        tiktok_share_url: result.publicShareUrl,
      })
      .eq('id', blogPostId)
      .eq('user_id', user.id)
    return NextResponse.json({ status: 'published', shareUrl: result.publicShareUrl, errorMessage: null })
  }
  if (result.status === 'FAILED') {
    await sb
      .from('blog_posts')
      .update({
        tiktok_publish_status: 'failed',
        tiktok_error_message: result.failureReason ?? 'TikTok rejected the publish.',
      })
      .eq('id', blogPostId)
      .eq('user_id', user.id)
    return NextResponse.json({ status: 'failed', shareUrl: null, errorMessage: result.failureReason })
  }

  // Still processing.
  return NextResponse.json({
    status: 'processing',
    rawStatus: result.rawStatus,
    shareUrl: null,
    errorMessage: null,
  })
}
