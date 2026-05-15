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
 * Gated to Growth+ tier. Free / Starter get 403.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { sendPhoto, sendMessage, escapeMarkdownV2 } from '@/services/telegram'
import { tierAllowsSocial, type Tier } from '@/lib/tier'

export const maxDuration = 60

const CAPTION_BUDGET = 800 // Telegram caption limit is 1024; leave room for URL + markdown.

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // ── Tier gate ───────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await (supabase as any)
      .from('integrations')
      .select('tier,telegram_channel_id')
      .eq('user_id', user.id)
      .single()
    const tier = (tierRow?.tier as Tier) ?? 'free'
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

    const { postId } = await request.json()
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    // ── Fetch post + thumbnail ──────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: postRow } = await (supabase as any)
      .from('blog_posts')
      .select('id,title,excerpt,content,wordpress_url,youtube_videos(thumbnail_url)')
      .eq('id', postId)
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const post = postRow as any
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    if (!post.wordpress_url) {
      return NextResponse.json({ error: 'Post has no published URL' }, { status: 400 })
    }

    const imageUrl = post.youtube_videos?.thumbnail_url as string | null

    // ── Fetch brand voice ───────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await (supabase as any)
      .from('brand_profiles')
      .select('name,voice_summary')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brand = brandRow as any

    // ── Generate caption ────────────────────────────────────────────────────
    const plainContent = (post.content as string ?? '')
      .replace(/<[^>]+>/g, '')
      .slice(0, 1500)

    const voiceNote = brand?.voice_summary
      ? `\n\nVoice guidance: ${brand.voice_summary}`
      : ''

    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Write a single Telegram channel post for this product review article.

Style: a content creator's authentic, scannable take. Strong hook in line 1, 2-3 short bullets or short lines with key takeaways, conversational. Match the voice provided.${voiceNote}

Hard rules:
- The post BEFORE we append the URL must be ${CAPTION_BUDGET} characters or fewer.
- Do NOT include any URL — we will append one as a separate line.
- Plain text only. NO markdown formatting (no **, no _, no [text](link)). The system will handle escaping.
- One emoji at the start of the hook is welcome. Don't pile them on.
- One hashtag at the end is fine, max one.

Blog title: ${post.title}
Blog excerpt: ${post.excerpt || plainContent.slice(0, 300)}
Content preview: ${plainContent}

Return ONLY the post text.`,
      }],
    })

    let captionText = ((msg.content[0] as { type: string; text: string }).text || '').trim()
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

    // ── Post to Telegram ────────────────────────────────────────────────────
    const result = imageUrl
      ? await sendPhoto(botToken, channelId, imageUrl, finalCaption)
      : await sendMessage(botToken, channelId, finalCaption)

    // ── Save message id on the blog row ─────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('blog_posts')
      .update({ telegram_message_id: String(result.messageId) })
      .eq('id', postId)

    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
      url: result.channelPostUrl ?? null,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
