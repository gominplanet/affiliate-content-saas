import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { ThreadsService } from '@/services/threads'
import { createAnthropicClient } from '@/lib/anthropic'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { capSocialText, SOCIAL_LIMITS } from '@/lib/social-cap'
import { learnProfileToPrompt } from '@/lib/learn'

const DISCLAIMER = '#ad — As an Amazon Associate I earn from qualifying purchases.'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Threads auto-publish is Growth+ (Growth, Pro, Admin).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await (supabase as any)
      .from('integrations')
      .select('tier')
      .eq('user_id', user.id)
      .single()
    const tier = (tierRow?.tier as Tier) ?? 'free'
    if (!tierAllowsSocial(tier, 'threads')) {
      return NextResponse.json(
        { error: 'Threads auto-publish is a Growth plan feature. Upgrade to Growth or Pro to post to Threads.' },
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
      (supabase as any).from('blog_posts').select('*, youtube_videos(thumbnail_url)').eq('id', postId).single(),
      (supabase as any).from('integrations').select('*').eq('user_id', user.id).single(),
    ])

    const p = post as any
    const ig = integration as any

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await (supabase as any)
      .from('brand_profiles')
      .select('learn_profile')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brand = brandRow as any

    if (!p) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
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
    await (supabase as any).from('blog_posts').update({ threads_post_id: result.id }).eq('id', postId)

    return NextResponse.json({ ok: true, postId: result.id })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
