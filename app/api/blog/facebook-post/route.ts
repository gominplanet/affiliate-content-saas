import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createFacebookService } from '@/services/facebook'
import { createAnthropicClient } from '@/lib/anthropic'
import { learnProfileToPrompt } from '@/lib/learn'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { readSocialCount, incrementSocialCount, evaluateSocialCap, SOCIAL_CAP } from '@/lib/social-cap'
import { normalizeTier } from '@/lib/tier'
import { resolveSocialAccount } from '@/lib/social-accounts'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json() as { postId?: string; dryRun?: boolean; text?: string; socialAccountId?: string }
    const postId = body.postId
    const dryRun = body.dryRun === true
    const overrideText = body.text?.trim()
    const socialAccountId = body.socialAccountId
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    // ── 1. Fetch blog post ────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: postRow } = await (supabase as any)
      .from('blog_posts')
      .select('id,title,excerpt,content,wordpress_url,video_id,social_publish_counts')
      .eq('id', postId)
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const post = postRow as any
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    // Per-post re-publish cap (10 / platform). Pre-flight before any
    // AI caption work so an at-cap user doesn't burn a Sonnet call.
    const fbSocialCount = readSocialCount(post, 'facebook')
    const fbCap = evaluateSocialCap(fbSocialCount)
    if (!body.dryRun && fbCap.exceeded) {
      return NextResponse.json({
        error: `You've published this post to Facebook ${SOCIAL_CAP} times — that's the per-post cap on re-publishing. Edit the post or use a different post.`,
        socialCapReached: true,
        platform: 'facebook',
      }, { status: 429 })
    }

    // ── 2. Fetch video for thumbnail ──────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: videoRow } = await (supabase as any)
      .from('youtube_videos')
      .select('youtube_video_id,thumbnail_url')
      .eq('id', post.video_id)
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const video = videoRow as any

    // ── 3. Fetch brand for disclaimer ─────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await (supabase as any)
      .from('brand_profiles')
      .select('affiliate_disclaimer,name,learn_profile')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brand = brandRow as any
    const disclaimer = brand?.affiliate_disclaimer || '⚠️ This post may contain affiliate links. We may earn a commission at no extra cost to you.'

    // ── 4. Fetch Facebook credentials ─────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('facebook_page_id,facebook_page_access_token,tier')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const integration = intRow as any

    // Resolve WHICH Facebook Page to post to. Picking a specific page (vs the
    // default) is a Pro feature — non-Pro users always post to their default.
    // Falls back to the legacy single columns when social_accounts is empty.
    const isPro = ['pro', 'admin'].includes(normalizeTier(integration?.tier))
    const fbAccount = await resolveSocialAccount(supabase, user.id, 'facebook', {
      socialAccountId,
      allowSelection: isPro,
      legacy: {
        externalId: integration?.facebook_page_id,
        accessToken: integration?.facebook_page_access_token,
        displayName: integration?.facebook_page_name,
      },
    })
    if (!dryRun && !fbAccount) {
      return NextResponse.json({ error: 'Facebook not connected' }, { status: 400 })
    }

    // ── 5. Resolve Facebook review — override or fresh Claude gen ─────────────
    let reviewText: string
    if (overrideText) {
      reviewText = overrideText
    } else {
      const anthropic = createAnthropicClient()
      const learnBlock = learnProfileToPrompt(brand?.learn_profile)
      const blogText = `Title: ${post.title}\n\nExcerpt: ${post.excerpt || ''}\n\nContent (first 1500 chars):\n${(post.content as string).replace(/<[^>]+>/g, '').slice(0, 1500)}`

      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `Write a compelling ~300-word Facebook post promoting this blog article.

Write in first person, conversational tone. Include 2-3 relevant emojis naturally placed. End with a clear call to action to read the full post. Do NOT include the URL or disclaimer — those will be added separately. Do NOT use hashtags.${learnBlock ? `\n\n${learnBlock}` : ''}

${blogText}

Return ONLY the post text, nothing else.`,
        }],
      })

      reviewText = (msg.content[0] as { type: string; text: string }).text.trim()
      recordAnthropicUsage(msg, {
        userId: user.id, tier: integration?.tier,
        feature: 'social_facebook_caption', model: 'claude-sonnet-4-6',
      })
    }

    // ── 6. Build image URL ────────────────────────────────────────────────────
    const youtubeId = video?.youtube_video_id
    const imageUrl = youtubeId
      ? `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`
      : (video?.thumbnail_url || '')

    // ── 7. Build full caption ─────────────────────────────────────────────────
    const caption = `${reviewText}\n\n🔗 Read the full post: ${post.wordpress_url}\n\n${disclaimer}`

    if (dryRun) {
      // Generate 3 SPECIFIC, niche hashtags that fit this exact product/topic
      // (for the manual Group copy block) — not generic spam tags.
      let hashtags = ''
      try {
        const anthropic = createAnthropicClient()
        const hres = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 40,
          messages: [{
            role: 'user',
            content: `Give EXACTLY 3 hashtags for a Facebook post about this product/topic. They must be SPECIFIC and niche to the actual product/subject (e.g. for a cold brew maker: #coldbrew #coldbrewmaker #icedcoffee). Do NOT use generic spam tags like #amazonfinds, #musthave, #founditonamazon. Lowercase, no spaces inside a tag, each starting with #, space-separated. Return ONLY the 3 hashtags.

Title: ${post.title}
Topic: ${(post.content as string).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500)}`,
          }],
        })
        hashtags = (hres.content[0] as { type: string; text: string }).text
          .trim().split(/\s+/).filter(t => t.startsWith('#')).slice(0, 3).join(' ')
        recordAnthropicUsage(hres, {
          userId: user.id, tier: integration?.tier,
          feature: 'social_facebook_hashtags', model: 'claude-haiku-4-5-20251001',
        })
      } catch { /* hashtags optional — copy block still works without them */ }
      return NextResponse.json({ ok: true, dryRun: true, text: reviewText, finalText: caption, hashtags })
    }

    // ── 8. Post to Facebook ───────────────────────────────────────────────────
    const fbService = createFacebookService(
      fbAccount!.accessToken,
      fbAccount!.externalId,
    )

    let result
    if (imageUrl) {
      result = await fbService.postPhoto({ imageUrl, caption })
    } else {
      result = await fbService.postLink({ message: caption, link: post.wordpress_url })
    }

    // ── 9. Save facebook_post_id ──────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('blog_posts')
      .update({ facebook_post_id: result.id })
      .eq('id', postId)

    // Bump the per-post re-publish counter so the cap holds across
    // subsequent re-publishes of the same post.
    await incrementSocialCount(supabase, postId, 'facebook')
    const newCount = fbSocialCount + 1

    return NextResponse.json({
      ok: true,
      facebookPostId: result.id,
      publishCount: newCount,
      // Tell the client when this was the user's last allowed publish
      // so they can show a one-time warning ("next one will fail").
      isLastAllowed: fbCap.willBeLast,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
