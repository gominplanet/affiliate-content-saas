import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { createAnthropicClient } from '@/lib/anthropic'
import { createSession, createPost } from '@/services/bluesky'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { learnProfileToPrompt } from '@/lib/learn'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { readSocialCount, incrementSocialCount, evaluateSocialCap, SOCIAL_CAP } from '@/lib/social-cap'
import { resolveBlogPostId } from '@/lib/resolve-post-id'

export const maxDuration = 60

const POST_CHAR_LIMIT = 300

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Bluesky auto-publish is Creator+ (free for us to run, but gives Creator
    // a meaningful extra channel over Starter).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations')
      .select('tier')
      .eq('user_id', user.id)
      .single()
    const tier = (tierRow?.tier as Tier) ?? 'trial'
    if (!tierAllowsSocial(tier, 'bluesky')) {
      return NextResponse.json(
        { error: 'Bluesky auto-publish is a Creator plan feature. Upgrade to Creator or Pro to post to Bluesky.' },
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
    if (!post.wordpress_url) {
      return NextResponse.json({ error: 'Post has no published URL' }, { status: 400 })
    }

    const bsSocialCount = readSocialCount(post, 'bluesky')
    const bsCap = evaluateSocialCap(bsSocialCount)
    if (!dryRun && bsCap.exceeded) {
      return NextResponse.json({
        error: `You've published this post to Bluesky ${SOCIAL_CAP} times — that's the per-post cap on re-publishing. Edit the post or use a different post.`,
        socialCapReached: true,
        platform: 'bluesky',
      }, { status: 429 })
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

    // ── 3. Fetch Bluesky credentials (skip on dryRun — preview doesn't publish) ─
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations')
      .select('bluesky_handle,bluesky_app_password,bluesky_did')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const integration = decryptIntegrationRow(intRow as any)
    if (!dryRun && (!integration?.bluesky_handle || !integration?.bluesky_app_password)) {
      return NextResponse.json({ error: 'Bluesky not connected' }, { status: 400 })
    }

    // ── 4. Resolve post copy — user override or fresh AI gen ───────────────
    // Bluesky max 300 chars. Reserve ~80 for the URL + spacing.
    const generationBudget = POST_CHAR_LIMIT - 80

    let postText: string
    if (overrideText) {
      postText = overrideText
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
          content: `Write a single Bluesky post for this product review article.

Style: a content creator's authentic short take. Strong hook, one clear value bullet, conversational. Match the voice provided.${voiceNote}${learnBlock ? `\n\n${learnBlock}` : ''}

Hard rules:
- The post text BEFORE the URL is appended must be ${generationBudget} characters or fewer.
- Do NOT include any URL — we will append one.
- Do NOT use hashtags unless one feels genuinely necessary; at most one.
- Plain text only, no markdown.

Truthfulness: Do NOT claim you personally tested or used a product unless the article says you did. If this is a comparison or round-up that may include other creators' videos, frame it as "I compared…" / "here's my pick", NEVER "I tested both/all of them". Never invent first-hand experience.

Blog title: ${post.title}
Blog excerpt: ${post.excerpt || plainContent.slice(0, 300)}
Content preview: ${plainContent}

Return ONLY the post text.`,
        }],
      })

      postText = ((msg.content[0] as { type: string; text: string }).text || '').trim()
      recordAnthropicUsage(msg, {
        userId: user.id, tier,
        feature: 'social_bluesky_caption', model: 'claude-haiku-4-5-20251001',
      })
    }

    // Always defensively cap, even user-edited (they could paste over the limit)
    if (postText.length > generationBudget) {
      postText = postText.slice(0, generationBudget - 1).replace(/\s+\S*$/, '') + '…'
    }

    const url = post.wordpress_url as string
    const finalText = `${postText}\n\n${url}`

    // Dry-run: return the generated text without publishing
    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, text: postText, finalText })
    }

    // ── 5. Login and post ──────────────────────────────────────────────────
    const session = await createSession(integration.bluesky_handle, integration.bluesky_app_password)
    const result = await createPost(session, {
      text: finalText,
      linkUrl: url,
      linkText: url,
    })

    // ── 6. Save post URI on the blog row ───────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase
      .from('blog_posts')
      .update({ bluesky_post_uri: result.uri })
      .eq('id', postId)
    await incrementSocialCount(supabase, postId!, 'bluesky')

    return NextResponse.json({
      ok: true,
      uri: result.uri,
      publishCount: bsSocialCount + 1,
      isLastAllowed: bsCap.willBeLast,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
