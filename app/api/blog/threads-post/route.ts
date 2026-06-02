import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { ThreadsService } from '@/services/threads'
import { createAnthropicClient } from '@/lib/anthropic'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { capSocialText, SOCIAL_LIMITS } from '@/lib/social-cap'
import { learnProfileToPrompt } from '@/lib/learn'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { readSocialCount, incrementSocialCount, evaluateSocialCap, SOCIAL_CAP } from '@/lib/social-cap'
import { metaEnabledForUser } from '@/lib/feature-flags'

const DISCLAIMER = '#ad — As an Amazon Associate I earn from qualifying purchases.'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!(await metaEnabledForUser(supabase, user))) return NextResponse.json({ error: 'Threads publishing is temporarily unavailable while our Meta integration is under review.' }, { status: 503 })

    // Threads auto-publish is Creator+ (Creator, Pro, Admin).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations')
      .select('tier')
      .eq('user_id', user.id)
      .single()
    const tier = (tierRow?.tier as Tier) ?? 'trial'
    if (!tierAllowsSocial(tier, 'threads')) {
      return NextResponse.json(
        { error: 'Threads auto-publish is a Creator plan feature. Upgrade to Creator or Pro to post to Threads.' },
        { status: 403 },
      )
    }

    const body = await request.json() as { postId?: string; dryRun?: boolean; text?: string }
    const postId = body.postId
    const dryRun = body.dryRun === true
    const overrideText = body.text?.trim()
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [{ data: post }, { data: integration }] = await Promise.all([
      supabase.from('blog_posts').select('*, youtube_videos(thumbnail_url)').eq('id', postId).single(),
      supabase.from('integrations').select('*').eq('user_id', user.id).single(),
    ])

    const p = post as any
    // Decrypt secret columns transparently (2026-06-02 rollout).
    const ig = decryptIntegrationRow(integration as any)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await supabase
      .from('brand_profiles')
      .select('learn_profile')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brand = brandRow as any

    if (!p) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    const thSocialCount = readSocialCount(p, 'threads')
    const thCap = evaluateSocialCap(thSocialCount)
    if (!dryRun && thCap.exceeded) {
      return NextResponse.json({
        error: `You've published this post to Threads ${SOCIAL_CAP} times — that's the per-post cap on re-publishing. Edit the post or use a different post.`,
        socialCapReached: true,
        platform: 'threads',
      }, { status: 429 })
    }

    if (!dryRun && !ig?.threads_access_token) return NextResponse.json({ error: 'Threads not connected' }, { status: 400 })
    if (!dryRun && !ig?.threads_user_id) return NextResponse.json({ error: 'Threads user ID missing — try reconnecting Threads in Settings' }, { status: 400 })

    let bodyText: string
    if (overrideText) {
      bodyText = overrideText
    } else {
      const anthropic = createAnthropicClient()
      const learnBlock = learnProfileToPrompt(brand?.learn_profile)
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Write a Threads post for this blog article. Make it punchy and conversational — like a creator sharing a genuine find. Start with a hook that stops the scroll. Include the blog URL. End with 2-3 relevant hashtags. Keep the ENTIRE post under 450 characters (leave room for the disclaimer).${learnBlock ? `\n\n${learnBlock}` : ''}

Blog title: ${p.title}
Blog excerpt: ${p.excerpt || p.content?.substring(0, 300) || ''}
Blog URL: ${p.wordpress_url}

Write ONLY the post text, nothing else. Do not include a disclaimer or #ad tag.`,
        }],
      })
      bodyText = (msg.content[0] as { type: string; text: string }).text
      recordAnthropicUsage(msg, {
        userId: user.id, tier,
        feature: 'social_threads_caption', model: 'claude-haiku-4-5-20251001',
      })
    }

    // Threads API hard caps body text at 500 chars. Cap defensively then append disclaimer.
    const sep = '\n\n'
    const fullText = capSocialText(bodyText, SOCIAL_LIMITS.threads, `${sep}${DISCLAIMER}`)

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, text: bodyText.trim(), finalText: fullText })
    }

    // Use YouTube thumbnail (hero image with person + product)
    const imageUrl = p.youtube_videos?.thumbnail_url || null

    const threads = new ThreadsService(ig.threads_access_token, ig.threads_user_id)
    const result = await threads.createPost(fullText, imageUrl ?? undefined)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('blog_posts').update({ threads_post_id: result.id }).eq('id', postId)
    await incrementSocialCount(supabase, postId!, 'threads')

    return NextResponse.json({
      ok: true,
      postId: result.id,
      publishCount: thSocialCount + 1,
      isLastAllowed: thCap.willBeLast,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
