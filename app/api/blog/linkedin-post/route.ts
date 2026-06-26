import { NextRequest, NextResponse } from 'next/server'
import { scrubBanned } from '@/lib/scrub'
import { createServerClient } from '@/lib/supabase/server'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { createLinkedInService } from '@/services/linkedin'
import { createAnthropicClient } from '@/lib/anthropic'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { capSocialText, SOCIAL_LIMITS } from '@/lib/social-cap'
import { learnProfileToPrompt } from '@/lib/learn'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { readSocialCount, incrementSocialCount, evaluateSocialCap, SOCIAL_CAP } from '@/lib/social-cap'
import { resolveBlogPostId } from '@/lib/resolve-post-id'
import { recordSocialPermalink } from '@/lib/social-permalink'
import { socialPermalink } from '@/lib/brand-recap'
import { fetchOgImage, stripLinkPlaceholders } from '@/lib/og-image'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // LinkedIn posting is Creator+ (Creator, Pro, Admin).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations')
      .select('tier')
      .eq('user_id', user.id)
      .single()
    const tier = (tierRow?.tier as Tier) ?? 'trial'
    if (!tierAllowsSocial(tier, 'linkedin')) {
      return NextResponse.json(
        { error: 'LinkedIn posting is a Creator plan feature. Upgrade to Creator or Pro to publish to LinkedIn.' },
        { status: 403 },
      )
    }

    const body = await request.json() as { postId?: string; dryRun?: boolean; text?: string; postUrl?: string }
    const rawPostId = body.postId
    const dryRun = body.dryRun === true
    const overrideText = body.text?.trim()
    if (!rawPostId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
    // Content-page "Published Posts" rows for video-less posts (guides,
    // comparisons, link posts) send the WP post id, not the blog_posts UUID.
    const postId = (await resolveBlogPostId(supabase, user.id, rawPostId, body.postUrl)) || rawPostId

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
    if (!post.wordpress_url) return NextResponse.json({ error: 'Post has no published URL' }, { status: 400 })

    const liSocialCount = readSocialCount(post, 'linkedin')
    const liCap = evaluateSocialCap(liSocialCount)
    if (!dryRun && liCap.exceeded) {
      return NextResponse.json({
        error: `You've published this post to LinkedIn ${SOCIAL_CAP} times — that's the per-post cap on re-publishing. Edit the post or use a different post.`,
        socialCapReached: true,
        platform: 'linkedin',
      }, { status: 429 })
    }

    // ── Resolve a thumbnail for a native IMAGE post (mirrors the Facebook flow) ─
    // Video posts → YouTube / stored thumbnail; video-less posts (campaigns,
    // guides, comparisons) → the article's og:image (the featured image).
    let imageUrl = ''
    if (post.video_id) {
      const { data: vid } = await supabase
        .from('youtube_videos')
        .select('youtube_video_id,thumbnail_url')
        .eq('id', post.video_id)
        .eq('user_id', user.id)
        .maybeSingle()
      imageUrl = vid?.youtube_video_id
        ? `https://img.youtube.com/vi/${vid.youtube_video_id}/maxresdefault.jpg`
        : (vid?.thumbnail_url || '')
    }
    if (!imageUrl) imageUrl = (await fetchOgImage(post.wordpress_url)) || ''

    // ── 2. Fetch brand voice ──────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await supabase
      .from('brand_profiles')
      .select('name,voice_summary,learn_profile')
      .eq('user_id', user.id)
      .maybeSingle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brand = brandRow as any

    // ── 3. Fetch LinkedIn credentials ─────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await supabase
      .from('integrations')
      .select('linkedin_access_token,linkedin_person_id,linkedin_person_name')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const integration = decryptIntegrationRow(intRow as any)
    if (!dryRun && (!integration?.linkedin_access_token || !integration?.linkedin_person_id)) {
      return NextResponse.json({ error: 'LinkedIn not connected' }, { status: 400 })
    }

    // ── 4. Resolve LinkedIn post — override or fresh Claude gen ───────────────
    const plainContent = (post.content as string ?? '')
      .replace(/<[^>]+>/g, '')
      .slice(0, 1500)

    let rawText: string
    if (overrideText) {
      rawText = overrideText
    } else {
      const anthropic = createAnthropicClient()
      const voiceNote = brand?.voice_summary
        ? `\n\nVoice guidance: ${brand.voice_summary}`
        : ''
      const learnBlock = learnProfileToPrompt(brand?.learn_profile)

      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Write a compelling LinkedIn post for this blog article.

Style: professional yet approachable, like a creator sharing a genuine find with their audience. Start with a strong hook that grabs attention. Share 2-3 key insights or takeaways from the article. End with a short call to action to read the full review. Use line breaks for readability. Include 3-5 relevant hashtags at the end.${voiceNote}${learnBlock ? `\n\n${learnBlock}` : ''}

Keep the ENTIRE post under 600 characters (LinkedIn sweet spot for engagement).

Truthfulness: Do NOT claim you personally tested or used a product unless the article says you did. If this is a comparison or round-up that may include other creators' videos, frame it as "I compared…" / "here's my pick", NEVER "I tested both/all of them". Never invent first-hand experience.

The article link is attached automatically (as the post's image caption or a link card) — do NOT write the URL yourself, and NEVER write "[link in comments]", "link in comments", "[link]", or any bracketed placeholder. Write only the post copy.

Blog title: ${post.title}
Blog excerpt: ${post.excerpt || plainContent.slice(0, 300)}
Content preview: ${plainContent}

Return ONLY the post text, no extra commentary.`,
        }],
      })
      rawText = (msg.content[0] as { type: string; text: string }).text
      recordAnthropicUsage(msg, {
        userId: user.id, tier,
        feature: 'social_linkedin_caption', model: 'claude-haiku-4-5-20251001',
      })
    }

    // Strip any "link in comments" / bracketed placeholder the model may have
    // invented — the link is the article card (ARTICLE share) or appended below
    // (IMAGE share), never a comment.
    const cleaned = scrubBanned(stripLinkPlaceholders(rawText))
    // For an IMAGE post the link must live in the caption (no card); for the
    // ARTICLE fallback the card carries it, so don't duplicate it.
    const withLink = (imageUrl && !cleaned.includes(post.wordpress_url))
      ? `${cleaned}\n\n🔗 Read the full review: ${post.wordpress_url}`
      : cleaned
    // LinkedIn's UGC API allows up to 3000 chars per post — defensive cap.
    const postText = capSocialText(withLink, SOCIAL_LIMITS.linkedin)

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, text: postText, finalText: postText })
    }

    // ── 5. Publish to LinkedIn ────────────────────────────────────────────────
    const linkedin = createLinkedInService(
      integration.linkedin_access_token,
      integration.linkedin_person_id,
    )

    // Prefer a native IMAGE post (shows the thumbnail); fall back to the
    // ARTICLE link-card share if there's no image or the upload fails.
    let result: { id: string }
    const articleArgs = {
      articleUrl: post.wordpress_url,
      articleTitle: post.title,
      articleDescription: post.excerpt || plainContent.slice(0, 200),
    }
    if (imageUrl) {
      try {
        result = await linkedin.createImagePost({
          text: postText,
          imageUrl,
          title: post.title,
          description: post.excerpt || plainContent.slice(0, 200),
        })
      } catch {
        result = await linkedin.createPost({ text: postText, ...articleArgs })
      }
    } else {
      result = await linkedin.createPost({ text: postText, ...articleArgs })
    }

    // ── 6. Save linkedin_post_id ──────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase
      .from('blog_posts')
      .update({ linkedin_post_id: result.id })
      .eq('id', postId)
    // Record the real permalink so the brand-recap links straight to the post.
    await recordSocialPermalink(supabase, postId!, 'linkedin', socialPermalink.linkedin(result.id))
    await incrementSocialCount(supabase, postId!, 'linkedin')

    return NextResponse.json({
      ok: true,
      linkedInPostId: result.id,
      publishCount: liSocialCount + 1,
      isLastAllowed: liCap.willBeLast,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
