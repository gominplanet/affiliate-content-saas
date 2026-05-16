import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createLinkedInService } from '@/services/linkedin'
import { createAnthropicClient } from '@/lib/anthropic'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { capSocialText, SOCIAL_LIMITS } from '@/lib/social-cap'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // LinkedIn posting is Growth+ (included on Growth, Pro, Admin).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await (supabase as any)
      .from('integrations')
      .select('tier')
      .eq('user_id', user.id)
      .single()
    const tier = (tierRow?.tier as Tier) ?? 'free'
    if (!tierAllowsSocial(tier, 'linkedin')) {
      return NextResponse.json(
        { error: 'LinkedIn posting is a Growth plan feature. Upgrade to Growth or Pro to publish to LinkedIn.' },
        { status: 403 },
      )
    }

    const { postId } = await request.json()
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    // ── 1. Fetch blog post ────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: postRow } = await (supabase as any)
      .from('blog_posts')
      .select('id,title,excerpt,content,wordpress_url,video_id')
      .eq('id', postId)
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const post = postRow as any
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    if (!post.wordpress_url) return NextResponse.json({ error: 'Post has no published URL' }, { status: 400 })

    // ── 2. Fetch brand voice ──────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await (supabase as any)
      .from('brand_profiles')
      .select('name,voice_summary')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brand = brandRow as any

    // ── 3. Fetch LinkedIn credentials ─────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('linkedin_access_token,linkedin_person_id,linkedin_person_name')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const integration = intRow as any
    if (!integration?.linkedin_access_token || !integration?.linkedin_person_id) {
      return NextResponse.json({ error: 'LinkedIn not connected' }, { status: 400 })
    }

    // ── 4. Generate LinkedIn post with Claude ─────────────────────────────────
    const anthropic = createAnthropicClient()
    const plainContent = (post.content as string ?? '')
      .replace(/<[^>]+>/g, '')
      .slice(0, 1500)

    const voiceNote = brand?.voice_summary
      ? `\n\nVoice guidance: ${brand.voice_summary}`
      : ''

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Write a compelling LinkedIn post for this blog article.

Style: professional yet approachable, like a creator sharing a genuine find with their audience. Start with a strong hook that grabs attention. Share 2-3 key insights or takeaways from the article. End with a call to action to read the full post. Use line breaks for readability. Include 3-5 relevant hashtags at the end.${voiceNote}

Keep the ENTIRE post under 600 characters (LinkedIn sweet spot for engagement).

Blog title: ${post.title}
Blog excerpt: ${post.excerpt || plainContent.slice(0, 300)}
Content preview: ${plainContent}

Return ONLY the post text, no extra commentary.`,
      }],
    })

    // LinkedIn's UGC API allows up to 3000 chars per post — defensive cap
    // in case the model drifts way past the 600-char target.
    const postText = capSocialText((msg.content[0] as { type: string; text: string }).text, SOCIAL_LIMITS.linkedin)

    // ── 5. Publish to LinkedIn ────────────────────────────────────────────────
    const linkedin = createLinkedInService(
      integration.linkedin_access_token,
      integration.linkedin_person_id,
    )

    const result = await linkedin.createPost({
      text: postText,
      articleUrl: post.wordpress_url,
      articleTitle: post.title,
      articleDescription: post.excerpt || plainContent.slice(0, 200),
    })

    // ── 6. Save linkedin_post_id ──────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('blog_posts')
      .update({ linkedin_post_id: result.id })
      .eq('id', postId)

    return NextResponse.json({ ok: true, linkedInPostId: result.id })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
