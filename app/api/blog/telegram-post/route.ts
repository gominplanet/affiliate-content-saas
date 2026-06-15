/**
 * POST /api/blog/telegram-post
 *
 * Publishes a completed blog post to the user's Telegram channel.
 *
 * Architecture (per AFFILIATE_PROGRAM.md / docs):
 *   - One shared MVP Affiliate bot (token in env: TELEGRAM_BOT_TOKEN)
 *   - User adds that bot as admin of their own channel
 *   - User stores their channel ID (e.g. "@mvpreviews" or "-100…") in
 *     integrations.telegram_channel_id
 *
 * Gated to Pro tier. Trial / Creator get 403.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { sendPhoto, sendMessage, escapeMarkdownV2 } from '@/services/telegram'
import { fetchOgImage, stripLinkPlaceholders } from '@/lib/og-image'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { learnProfileToPrompt } from '@/lib/learn'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { readSocialCount, incrementSocialCount, evaluateSocialCap, SOCIAL_CAP } from '@/lib/social-cap'
import { resolveBlogPostId } from '@/lib/resolve-post-id'

export const maxDuration = 60

const CAPTION_BUDGET = 800 // Telegram caption limit is 1024; leave room for URL + markdown.

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // ── Tier gate ───────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations')
      .select('tier,telegram_channel_id')
      .eq('user_id', user.id)
      .single()
    const tier = (tierRow?.tier as Tier) ?? 'trial'
    if (!tierAllowsSocial(tier, 'telegram')) {
      return NextResponse.json(
        { error: 'Telegram auto-publish is a Pro plan feature. Upgrade to Pro to post reviews to your Telegram channel.' },
        { status: 403 },
      )
    }

    const channelId = tierRow?.telegram_channel_id as string | null
    if (!channelId) {
      return NextResponse.json({ error: 'Telegram channel not connected' }, { status: 400 })
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) {
      // Server misconfig — bot token should be set in production env.
      return NextResponse.json({ error: 'Telegram bot not configured on the server' }, { status: 500 })
    }

    const body = await request.json() as { postId?: string; dryRun?: boolean; text?: string }
    const rawPostId = body.postId
    const dryRun = body.dryRun === true
    const overrideText = body.text?.trim()
    if (!rawPostId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
    // Content-page "Published Posts" rows for video-less posts (guides,
    // comparisons, link posts) send the WP post id, not the blog_posts UUID.
    const postId = (await resolveBlogPostId(supabase, user.id, rawPostId)) || rawPostId

    // ── Fetch post + thumbnail ──────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: postRow } = await supabase
      .from('blog_posts')
      .select('id,title,excerpt,content,wordpress_url,social_publish_counts,youtube_videos(thumbnail_url)')
      .eq('id', postId)
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const post = postRow as any
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    if (!post.wordpress_url) {
      return NextResponse.json({ error: 'Post has no published URL' }, { status: 400 })
    }

    const tgSocialCount = readSocialCount(post, 'telegram')
    const tgCap = evaluateSocialCap(tgSocialCount)
    if (!dryRun && tgCap.exceeded) {
      return NextResponse.json({
        error: `You've published this post to Telegram ${SOCIAL_CAP} times — that's the per-post cap on re-publishing. Edit the post or use a different post.`,
        socialCapReached: true,
        platform: 'telegram',
      }, { status: 429 })
    }

    let imageUrl = (post.youtube_videos?.thumbnail_url as string | null) || null

    // ── Fetch brand voice ───────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await supabase
      .from('brand_profiles')
      .select('name,voice_summary,learn_profile')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brand = brandRow as any

    // ── Resolve caption — override or fresh AI gen ───────────────────────────
    let captionText: string
    if (overrideText) {
      captionText = overrideText
    } else {
      const plainContent = (post.content as string ?? '')
        .replace(/<[^>]+>/g, '')
        .slice(0, 1500)

      const voiceNote = brand?.voice_summary
        ? `\n\nVoice guidance: ${brand.voice_summary}`
        : ''
      const learnBlock = learnProfileToPrompt(brand?.learn_profile)

      const anthropic = createAnthropicClient()
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Write a single Telegram channel post for this product review article.

Style: a content creator's authentic, scannable take. Strong hook in line 1, 2-3 short bullets or short lines with key takeaways, conversational. Match the voice provided.${voiceNote}${learnBlock ? `\n\n${learnBlock}` : ''}

Hard rules:
- The post BEFORE we append the URL must be ${CAPTION_BUDGET} characters or fewer.
- Do NOT include any URL — we will append one as a separate line.
- Plain text only. NO markdown formatting (no **, no _, no [text](link)). The system will handle escaping.
- One emoji at the start of the hook is welcome. Don't pile them on.
- One hashtag at the end is fine, max one.

Truthfulness: Do NOT claim you personally tested or used a product unless the article says you did. If this is a comparison or round-up that may include other creators' videos, frame it as "I compared…" / "here's my pick", NEVER "I tested both/all of them". Never invent first-hand experience.

Blog title: ${post.title}
Blog excerpt: ${post.excerpt || plainContent.slice(0, 300)}
Content preview: ${plainContent}

Return ONLY the post text.`,
        }],
      })
      captionText = ((msg.content[0] as { type: string; text: string }).text || '').trim()
      recordAnthropicUsage(msg, {
        userId: user.id, tier,
        feature: 'social_telegram_caption', model: 'claude-haiku-4-5-20251001',
      })
    }

    captionText = stripLinkPlaceholders(captionText)
    if (captionText.length > CAPTION_BUDGET) {
      captionText = captionText.slice(0, CAPTION_BUDGET - 1).replace(/\s+\S*$/, '') + '…'
    }

    // Build the final caption with a properly-escaped "Read the full review →"
    // CTA link in MarkdownV2. Everything user-derived (title, body, URL) must
    // be escaped to avoid 400 from the Telegram API.
    const escapedBody = escapeMarkdownV2(captionText)
    const escapedUrl = escapeMarkdownV2(post.wordpress_url as string)
    const linkLabel = escapeMarkdownV2('Read the full review →')
    const finalCaption = `${escapedBody}\n\n[${linkLabel}](${escapedUrl})`

    if (dryRun) {
      // Show the body the user can edit; finalText is the rendered Markdown
      // version that ships to Telegram (with the CTA link appended).
      return NextResponse.json({ ok: true, dryRun: true, text: captionText, finalText: `${captionText}\n\nRead the full review → ${post.wordpress_url}` })
    }

    // Video-less posts (campaigns, guides, comparisons) have no YouTube
    // thumbnail — fall back to the article's og:image so they still post WITH a
    // photo (sendPhoto) instead of text-only.
    if (!imageUrl) imageUrl = (await fetchOgImage(post.wordpress_url as string)) || null

    // ── Post to Telegram ────────────────────────────────────────────────────
    const result = imageUrl
      ? await sendPhoto(botToken, channelId, imageUrl, finalCaption)
      : await sendMessage(botToken, channelId, finalCaption)

    // ── Save message id on the blog row ─────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase
      .from('blog_posts')
      .update({ telegram_message_id: String(result.messageId) })
      .eq('id', postId)
    await incrementSocialCount(supabase, postId!, 'telegram')

    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
      url: result.channelPostUrl ?? null,
      publishCount: tgSocialCount + 1,
      isLastAllowed: tgCap.willBeLast,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
