// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Articles refresh — keep published informational articles current.
//   GET  → { ok, articles: [{ id, title, url, updatedAt }] }  (recent articles)
//   POST { postId } → re-research the topic with web_search and rewrite the post,
//         refreshing stats / prices / dates / facts while keeping its structure,
//         then UPDATE the existing WordPress post + blog_posts row in place (no
//         new post, no new URL). Rivals Koala's "update old content".
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { learnProfileToPrompt } from '@/lib/learn'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { scrubAiHtml } from '@/lib/html-scrub'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { normalizeTier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { toUserMessage } from '@/lib/friendly-error'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('blog_posts')
    .select('id,title,wordpress_url,updated_at,published_at')
    .eq('user_id', user.id)
    .eq('post_type', 'article')
    .eq('status', 'published')
    .not('wordpress_url', 'is', null)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(50)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const articles = ((data ?? []) as any[]).map(r => ({
    id: r.id as string, title: (r.title as string) || 'Untitled',
    url: (r.wordpress_url as string) || null, updatedAt: (r.updated_at as string) || (r.published_at as string) || null,
  }))
  return NextResponse.json({ ok: true, articles })
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: integ } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = normalizeTier(integ?.tier)
    if (await spendGate(user.id, tier)) {
      return NextResponse.json({ error: 'You’ve hit today’s AI spend limit. Try again tomorrow.' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({})) as { postId?: string }
    const postId = (body.postId || '').trim()
    if (!postId) return NextResponse.json({ error: 'postId is required.' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: post } = await (supabase as any)
      .from('blog_posts')
      .select('id,title,content,seo_keyword,wordpress_post_id,wordpress_url,post_type')
      .eq('id', postId).eq('user_id', user.id).maybeSingle()
    if (!post) return NextResponse.json({ error: 'Article not found.' }, { status: 404 })
    if (!post.wordpress_post_id) return NextResponse.json({ error: 'This article isn’t linked to a WordPress post, so it can’t be refreshed in place.' }, { status: 400 })

    const title = (post.title as string) || ''
    const topic = (post.seo_keyword as string) || title
    const existingHtml = (post.content as string) || ''
    if (existingHtml.length < 200) return NextResponse.json({ error: 'This article has no stored body to refresh.' }, { status: 400 })

    // The creator's trained voice — keep the refresh sounding like them, not like
    // a generic rewrite. Same LEARN profile + writing sample the writer uses.
    const { data: brand } = await supabase
      .from('brand_profiles')
      .select('learn_profile,writing_sample,words_to_avoid')
      .eq('user_id', user.id).maybeSingle()
    const learn = learnProfileToPrompt(brand?.learn_profile)
    const sample = (((brand?.writing_sample as string) || '').trim()).slice(0, 1200)
    const avoid = Array.isArray(brand?.words_to_avoid)
      ? (brand!.words_to_avoid as string[]).map(w => (w || '').trim()).filter(Boolean).slice(0, 30) : []
    const vParts: string[] = []
    if (learn) vParts.push(learn.trim())
    if (sample) vParts.push(`THE CREATOR'S OWN WRITING SAMPLE — keep the refreshed copy in this voice:\n"""${sample}"""`)
    if (avoid.length) vParts.push(`WORDS THE CREATOR NEVER USES — do not introduce any of these: ${avoid.join(', ')}.`)
    const voiceBlock = vParts.length ? `\n\n${vParts.join('\n\n')}` : ''

    const client = createAnthropicClient()
    const prompt = `You are UPDATING an existing published article so it stays current. Use the web_search tool to re-check the facts, and refresh anything out of date: statistics, prices, percentages, dated figures, study findings, product availability, and any "as of" language. Keep the SAME structure, headings, angle and voice — this is a refresh, not a rewrite. Keep every existing inline source link that is still valid and add new linked sources (rel="nofollow") for any figure you change. Do not add or remove sections.

TOPIC: ${topic}
TITLE (do not change): ${title}

RULES:
- Return ONLY the updated article body as semantic HTML (<h2>, <h3>, <p>, <ul>/<li>, <table>, <div>, <blockquote>, <a>). No <h1>, no markdown, no code fence, no <html>/<head>/<body>.
- NEVER use <svg>, <canvas>, <script> or <style> (WordPress strips them).
- ABSOLUTE BAN on em-dashes and en-dashes. Never put a year inside a heading or the title. No invented numbers — only figures a search result supports.

EXISTING ARTICLE HTML TO UPDATE:
${existingHtml.slice(0, 24000)}${voiceBlock}`

    let html = ''
    try {
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 } as any],
        messages: [{ role: 'user', content: prompt }],
      })
      recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'article_refresh', model: 'claude-sonnet-4-6' })
      let raw = ''
      for (const b of msg.content) if (b.type === 'text') raw += b.text
      html = scrubAiHtml(raw.trim())
    } catch (err) {
      return NextResponse.json({ error: toUserMessage(err, 'Couldn’t refresh the article just now. Please try again.') }, { status: 500 })
    }
    if (html.length < 200) return NextResponse.json({ error: 'The refresh came back empty. Please try again.' }, { status: 500 })

    // Update the SAME WordPress post + our row in place.
    const site = await getWordPressCredentials(supabase, user.id)
    if (!site) return NextResponse.json({ error: 'No WordPress site connected.' }, { status: 400 })
    const wpService = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)
    await wpService.updatePost(Number(post.wordpress_post_id), { content: html })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('blog_posts').update({ content: html, updated_at: new Date().toISOString() }).eq('id', postId).eq('user_id', user.id)

    return NextResponse.json({ ok: true, url: (post.wordpress_url as string) || null })
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err, 'Couldn’t refresh the article just now. Please try again.') }, { status: 500 })
  }
}
