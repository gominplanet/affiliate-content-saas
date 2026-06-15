import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { decryptIntegrationRow, encryptIntegrationWrite } from '@/lib/integration-secrets'
import { createAnthropicClient } from '@/lib/anthropic'
import { learnProfileToPrompt } from '@/lib/learn'
import {
  createTweet,
  refreshAccessToken,
} from '@/services/twitter'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { readSocialCount, incrementSocialCount, evaluateSocialCap, SOCIAL_CAP } from '@/lib/social-cap'
import { resolveBlogPostId } from '@/lib/resolve-post-id'

export const maxDuration = 60

const TWEET_HARD_LIMIT = 280

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // X / Twitter auto-publish is a Pro-only feature.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations')
      .select('tier')
      .eq('user_id', user.id)
      .single()
    const tier = (tierRow?.tier as Tier) ?? 'trial'
    if (!tierAllowsSocial(tier, 'twitter')) {
      return NextResponse.json(
        { error: 'X (Twitter) posting is a Pro plan feature. Upgrade to Pro to publish to X.' },
        { status: 403 },
      )
    }

    const body = await request.json() as { postId?: string; dryRun?: boolean; text?: string }
    const rawPostId = body.postId
    const dryRun = body.dryRun === true
    const overrideText = body.text?.trim()
    if (!rawPostId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
    // Content-page "Published Posts" rows for video-less posts (guides,
    // comparisons, link posts) send the WP post id, not the blog_posts UUID.
    const postId = (await resolveBlogPostId(supabase, user.id, rawPostId)) || rawPostId

    // ── 1. Fetch blog post ─────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: postRow } = await supabase
      .from('blog_posts')
      .select('id,title,excerpt,content,wordpress_url,social_publish_counts')
      .eq('id', postId)
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const post = postRow as any
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    const twSocialCount = readSocialCount(post, 'twitter')
    const twCap = evaluateSocialCap(twSocialCount)
    if (!dryRun && twCap.exceeded) {
      return NextResponse.json({
        error: `You've published this post to X ${SOCIAL_CAP} times — that's the per-post cap on re-publishing. Edit the post or use a different post.`,
        socialCapReached: true,
        platform: 'twitter',
      }, { status: 429 })
    }

    if (!post.wordpress_url) {
      return NextResponse.json({ error: 'Post has no published URL' }, { status: 400 })
    }

    // ── 2. Fetch brand voice ───────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await supabase
      .from('brand_profiles')
      .select('name,voice_summary,learn_profile')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brand = brandRow as any

    // ── 3. Fetch X credentials ─────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations')
      .select('twitter_access_token,twitter_refresh_token,twitter_expires_at')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const integration = decryptIntegrationRow(intRow as any)
    if (!integration?.twitter_access_token) {
      return NextResponse.json({ error: 'X (Twitter) not connected' }, { status: 400 })
    }

    // ── 3a. Refresh the access token if it's expired or expiring soon ─────
    let accessToken = integration.twitter_access_token as string
    const expiresAtMs = integration.twitter_expires_at
      ? new Date(integration.twitter_expires_at).getTime()
      : 0
    const expiringSoon = expiresAtMs && expiresAtMs - Date.now() < 60_000
    if (expiringSoon && integration.twitter_refresh_token) {
      try {
        const refreshed = await refreshAccessToken(integration.twitter_refresh_token)
        accessToken = refreshed.access_token
        const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
        // Encrypt refreshed tokens at rest (2026-06-02). Decrypt happens
        // on the next read via decryptIntegrationRow.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from('integrations').update(encryptIntegrationWrite({
          twitter_access_token: refreshed.access_token,
          twitter_refresh_token: refreshed.refresh_token ?? integration.twitter_refresh_token,
          twitter_expires_at: newExpiry,
        })).eq('user_id', user.id)
      } catch (e) {
        return NextResponse.json(
          { error: 'X token refresh failed. Please reconnect X in Settings.', detail: e instanceof Error ? e.message : String(e) },
          { status: 401 },
        )
      }
    }

    // ── 4. Resolve tweet copy — user override or fresh AI gen ──────────────
    // Reserve characters for the URL — X autoshortens any URL to 23 chars,
    // and we add one space before it. Generation budget is 280 - 23 - 1 = 256.
    const generationBudget = TWEET_HARD_LIMIT - 23 - 1

    let tweetText: string
    if (overrideText) {
      tweetText = overrideText
    } else {
      const anthropic = createAnthropicClient()
      const plainContent = (post.content as string ?? '')
        .replace(/<[^>]+>/g, '')
        .slice(0, 1200)

      const voiceNote = brand?.voice_summary
        ? `\n\nVoice guidance: ${brand.voice_summary}`
        : ''
      const learnBlock = learnProfileToPrompt(brand?.learn_profile)

      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Write a single tweet for this product review article.

Style: a content creator's authentic short take. Strong hook, one clear value bullet, one short line of curiosity. Match the voice provided.${voiceNote}${learnBlock ? `\n\n${learnBlock}` : ''}

Hard rules:
- The tweet text alone (BEFORE the URL is appended) must be ${generationBudget} characters or fewer.
- Do NOT include any URL — we will append one ourselves.
- Do NOT use hashtags unless one feels genuinely necessary; at most one.
- Plain text only, no markdown.
- Stay TRUE to the article. Do NOT claim you personally tested or used a product unless the article actually says you did. If this is a comparison or round-up that may include other creators' videos, write "I compared…", "I put X against Y", or "here's my pick" — NEVER "I tested both/all of them". Never invent first-hand experience you don't have.

Blog title: ${post.title}
Blog excerpt: ${post.excerpt || plainContent.slice(0, 300)}
Content preview: ${plainContent}

Return ONLY the tweet text.`,
        }],
      })

      tweetText = ((msg.content[0] as { type: string; text: string }).text || '').trim()
      recordAnthropicUsage(msg, {
        userId: user.id, tier,
        feature: 'social_twitter_caption', model: 'claude-haiku-4-5-20251001',
      })
    }

    // Defensive trim — protects against AI drift AND user-edited overshoot
    if (tweetText.length > generationBudget) {
      tweetText = tweetText.slice(0, generationBudget - 1).replace(/\s+\S*$/, '') + '…'
    }

    const finalText = `${tweetText} ${post.wordpress_url}`

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, text: tweetText, finalText })
    }

    // ── 5. Post the tweet ──────────────────────────────────────────────────
    const tweet = await createTweet(accessToken, finalText)

    // ── 6. Save tweet id on the post ───────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase
      .from('blog_posts')
      .update({ twitter_post_id: tweet.id })
      .eq('id', postId)
    await incrementSocialCount(supabase, postId!, 'twitter')

    return NextResponse.json({
      ok: true,
      tweetId: tweet.id,
      publishCount: twSocialCount + 1,
      isLastAllowed: twCap.willBeLast,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
