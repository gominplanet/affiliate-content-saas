import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createFacebookService } from '@/services/facebook'
import { createAnthropicClient } from '@/lib/anthropic'
import { learnProfileToPrompt } from '@/lib/learn'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { readSocialCount, incrementSocialCount, evaluateSocialCap, SOCIAL_CAP } from '@/lib/social-cap'
import { normalizeTier, socialAccountCap } from '@/lib/tier'
import { resolveSocialAccounts } from '@/lib/social-accounts'
import { resolveBlogPostId } from '@/lib/resolve-post-id'
import { metaEnabledForUser } from '@/lib/feature-flags'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { maybeDecrypt } from '@/lib/secrets'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!(await metaEnabledForUser(supabase, user))) return NextResponse.json({ error: 'Facebook publishing is temporarily unavailable while our Meta integration is under review.' }, { status: 503 })

    const body = await request.json() as { postId?: string; dryRun?: boolean; text?: string; socialAccountId?: string; socialAccountIds?: string[] }
    const rawPostId = body.postId
    const dryRun = body.dryRun === true
    const overrideText = body.text?.trim()
    // Multi-account fan-out (Workstream 2): accept a list of chosen Page ids,
    // staying backward-compatible with the single `socialAccountId` field.
    const chosenAccountIds = (body.socialAccountIds && body.socialAccountIds.length)
      ? body.socialAccountIds
      : (body.socialAccountId ? [body.socialAccountId] : [])
    if (!rawPostId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
    // Video-less "Published Posts" rows send the WordPress post id — resolve to
    // the blog_posts UUID so the lookup/update below don't 404 ("Post not found").
    const postId = (await resolveBlogPostId(supabase, user.id, rawPostId)) || rawPostId

    // ── 1. Fetch blog post ────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: postRow } = await supabase
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
    const { data: videoRow } = await supabase
      .from('youtube_videos')
      .select('youtube_video_id,thumbnail_url')
      .eq('id', post.video_id)
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const video = videoRow as any

    // ── 3. Fetch brand for disclaimer ─────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await supabase
      .from('brand_profiles')
      .select('affiliate_disclaimer,name,learn_profile')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brand = brandRow as any
    const disclaimer = brand?.affiliate_disclaimer || '⚠️ This post may contain affiliate links. We may earn a commission at no extra cost to you.'

    // ── 4. Fetch Facebook credentials ─────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations')
      .select('facebook_page_id,facebook_page_access_token,tier')
      .eq('user_id', user.id)
      .single()
    // Decrypt secret columns transparently (2026-06-02 rollout).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const integration = decryptIntegrationRow(intRow as any)

    // Resolve WHICH Facebook Page to post to. Picking a specific page (vs the
    // default) is a Pro feature — non-Pro users always post to their default.
    // Falls back to the legacy single columns when social_accounts is empty.
    const tier = normalizeTier(integration?.tier)
    const isPro = ['pro', 'admin'].includes(tier)
    const fbAccounts = await resolveSocialAccounts(supabase, user.id, 'facebook', {
      socialAccountIds: chosenAccountIds,
      allowSelection: isPro,
      limit: socialAccountCap(tier),
      legacy: {
        externalId: integration?.facebook_page_id,
        accessToken: integration?.facebook_page_access_token,
        displayName: integration?.facebook_page_name,
      },
    })
    if (!dryRun && fbAccounts.length === 0) {
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

    // ── 8. Post to Facebook — fan out to each selected Page ───────────────────
    // Same caption to every Page; best-effort per account so one failure can't
    // abort the rest. A single-account post (the common case) runs this loop
    // exactly once and behaves identically to before.
    const results: Array<{ accountId: string | null; page: string | null; ok: boolean; id?: string; error?: string }> = []
    for (const acct of fbAccounts) {
      try {
        const fbService = createFacebookService(acct.accessToken, acct.externalId)
        const r = imageUrl
          ? await fbService.postPhoto({ imageUrl, caption })
          : await fbService.postLink({ message: caption, link: post.wordpress_url })
        results.push({ accountId: acct.id, page: acct.displayName, ok: true, id: r.id })
      } catch (e) {
        results.push({ accountId: acct.id, page: acct.displayName, ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }

    const succeeded = results.filter(r => r.ok)
    if (succeeded.length === 0) {
      return NextResponse.json(
        { error: results[0]?.error || 'Facebook publish failed', results },
        { status: 502 },
      )
    }

    // ── 9. Save facebook_post_id (first success) + bump re-publish counter ────
    const firstId = succeeded[0].id!
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('blog_posts').update({ facebook_post_id: firstId }).eq('id', postId)
    // Count one re-publish per Page actually posted to, so the per-post cap
    // holds across fan-outs and subsequent re-publishes.
    for (let i = 0; i < succeeded.length; i++) await incrementSocialCount(supabase, postId, 'facebook')
    const newCount = fbSocialCount + succeeded.length

    return NextResponse.json({
      ok: true,
      // Back-compat: existing clients read facebookPostId + publishCount.
      facebookPostId: firstId,
      publishCount: newCount,
      isLastAllowed: fbCap.willBeLast,
      // New: per-Page breakdown for the multi-account UI.
      posted: succeeded.length,
      results,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
