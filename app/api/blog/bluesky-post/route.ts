import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { createSession, createPost } from '@/services/bluesky'
import { tierAllowsSocial, type Tier } from '@/lib/tier'

export const maxDuration = 60

const POST_CHAR_LIMIT = 300

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Bluesky auto-publish is Growth+ (free for us to run, but gives Growth
    // a meaningful extra channel over Starter).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await (supabase as any)
      .from('integrations')
      .select('tier')
      .eq('user_id', user.id)
      .single()
    const tier = (tierRow?.tier as Tier) ?? 'free'
    if (!tierAllowsSocial(tier, 'bluesky')) {
      return NextResponse.json(
        { error: 'Bluesky auto-publish requires a paid plan. Upgrade to Starter, Growth, or Pro to post to Bluesky.' },
        { status: 403 },
      )
    }

    const { postId } = await request.json()
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    // ── 1. Fetch blog post ─────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: postRow } = await (supabase as any)
      .from('blog_posts')
      .select('id,title,excerpt,content,wordpress_url')
      .eq('id', postId)
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const post = postRow as any
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    if (!post.wordpress_url) {
      return NextResponse.json({ error: 'Post has no published URL' }, { status: 400 })
    }

    // ── 2. Fetch brand voice ───────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await (supabase as any)
      .from('brand_profiles')
      .select('name,voice_summary')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brand = brandRow as any

    // ── 3. Fetch Bluesky credentials ───────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: intRow } = await (supabase as any)
      .from('integrations')
      .select('bluesky_handle,bluesky_app_password,bluesky_did')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const integration = intRow as any
    if (!integration?.bluesky_handle || !integration?.bluesky_app_password) {
      return NextResponse.json({ error: 'Bluesky not connected' }, { status: 400 })
    }

    // ── 4. Generate post copy ──────────────────────────────────────────────
    // Bluesky max 300 chars. Reserve ~80 for the URL + spacing to keep the
    // generated text comfortably under the cap.
    const generationBudget = POST_CHAR_LIMIT - 80

    const anthropic = createAnthropicClient()
    const plainContent = (post.content as string ?? '')
      .replace(/<[^>]+>/g, '')
      .slice(0, 1200)

    const voiceNote = brand?.voice_summary
      ? `\n\nVoice guidance: ${brand.voice_summary}`
      : ''

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Write a single Bluesky post for this product review article.

Style: a content creator's authentic short take. Strong hook, one clear value bullet, conversational. Match the voice provided.${voiceNote}

Hard rules:
- The post text BEFORE the URL is appended must be ${generationBudget} characters or fewer.
- Do NOT include any URL — we will append one.
- Do NOT use hashtags unless one feels genuinely necessary; at most one.
- Plain text only, no markdown.

Blog title: ${post.title}
Blog excerpt: ${post.excerpt || plainContent.slice(0, 300)}
Content preview: ${plainContent}

Return ONLY the post text.`,
      }],
    })

    let postText = ((msg.content[0] as { type: string; text: string }).text || '').trim()
    if (postText.length > generationBudget) {
      postText = postText.slice(0, generationBudget - 1).replace(/\s+\S*$/, '') + '…'
    }

    const url = post.wordpress_url as string
    const finalText = `${postText}\n\n${url}`

    // ── 5. Login and post ──────────────────────────────────────────────────
    const session = await createSession(integration.bluesky_handle, integration.bluesky_app_password)
    const result = await createPost(session, {
      text: finalText,
      linkUrl: url,
      linkText: url,
    })

    // ── 6. Save post URI on the blog row ───────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('blog_posts')
      .update({ bluesky_post_uri: result.uri })
      .eq('id', postId)

    return NextResponse.json({ ok: true, uri: result.uri })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
