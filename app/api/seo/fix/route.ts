/**
 * POST /api/seo/fix  { postId, fix }
 *
 * The "MVP doesn't just tell you — it fixes it" action. Applies one SEO fix to
 * a published post and republishes to WordPress:
 *   - 'internal_links' : inject a topical "Related reviews" block (no AI)
 *   - 'faq'            : generate + insert an FAQ section (AEO + rich result)
 * Then re-scores the post and updates the post_seo cache. Returns the new score.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { pickRelatedPosts, renderRelatedLinksBlock, insertRelatedLinks, type LinkCandidate } from '@/lib/internal-links'
import { scorePostSeo } from '@/lib/seo-score'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { scrubBanned } from '@/lib/scrub'

export const maxDuration = 120

type FixType = 'internal_links' | 'faq'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Render an FAQ section in the exact format extractFaqFromHtml detects:
 *  <h2>Frequently Asked Questions</h2> then <h3>Q</h3> + <p>A</p> per item. */
function renderFaqBlock(items: { question: string; answer: string }[]): string {
  if (!items.length) return ''
  let out = '<!-- wp:heading --><h2>Frequently Asked Questions</h2><!-- /wp:heading -->'
  for (const it of items) {
    out += `<!-- wp:heading {"level":3} --><h3>${esc(it.question)}</h3><!-- /wp:heading -->`
    out += `<!-- wp:paragraph --><p>${esc(it.answer)}</p><!-- /wp:paragraph -->`
  }
  return out
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { postId, fix } = (await request.json().catch(() => ({}))) as { postId?: string; fix?: FixType }
  if (!postId || (fix !== 'internal_links' && fix !== 'faq')) {
    return NextResponse.json({ error: 'postId and a valid fix are required' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: post } = await (supabase as any)
    .from('blog_posts')
    .select('id,title,slug,content,seo_keyword,post_type,wordpress_post_id')
    .eq('user_id', user.id).eq('id', postId).maybeSingle()
  if (!post?.content || !post.wordpress_post_id) {
    return NextResponse.json({ error: 'Post not found or not published.' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wp } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token,tier')
    .eq('user_id', user.id).single()
  if (!wp?.wordpress_url || !wp?.wordpress_app_password) {
    return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
  }
  const wpBase = wp.wordpress_url.replace(/\/$/, '')
  const wpService = createWordPressService(wp.wordpress_url, wp.wordpress_username, wp.wordpress_app_password, wp.wordpress_api_token || undefined)

  let content = post.content as string

  try {
    if (fix === 'internal_links') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: others } = await (supabase as any)
        .from('blog_posts')
        .select('title,slug,seo_keyword')
        .eq('user_id', user.id)
        .not('wordpress_post_id', 'is', null)
        .neq('id', postId)
        .limit(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const candidates: LinkCandidate[] = ((others ?? []) as any[])
        .filter(o => o.title && o.slug)
        .map(o => ({ title: o.title as string, url: `${wpBase}/${o.slug}`, keyword: o.seo_keyword || undefined }))
      const related = pickRelatedPosts({ title: post.title || '', keyword: post.seo_keyword || undefined }, candidates, 3)
      if (related.length === 0) {
        return NextResponse.json({ error: 'No related posts found to link to yet — publish a few more reviews on similar topics first.' }, { status: 422 })
      }
      content = insertRelatedLinks(content, renderRelatedLinksBlock(related))
    }

    if (fix === 'faq') {
      const plain = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000)
      const client = createAnthropicClient()
      const resp = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: `From this product review, write 4 genuinely useful FAQs a buyer would ask, answered ONLY from the review's own facts (never invent specs or claims). Each answer 1–2 sentences, first person where natural. Respond ONLY as JSON: [{"question":"...","answer":"..."}].\n\nReview:\n${plain}`,
        }],
      })
      recordAnthropicUsage(resp, { userId: user.id, tier: wp?.tier, feature: 'seo_fix_faq', model: 'claude-haiku-4-5-20251001' })
      const raw = (resp.content[0] as { type: string; text: string }).text
      const match = raw.match(/\[[\s\S]*\]/)
      if (!match) return NextResponse.json({ error: 'Could not generate FAQ — try again.' }, { status: 502 })
      let items: { question: string; answer: string }[] = []
      try { items = JSON.parse(match[0]) } catch { return NextResponse.json({ error: 'FAQ format error — try again.' }, { status: 502 }) }
      items = items.filter(i => i?.question && i?.answer).slice(0, 6)
        .map(i => ({ question: scrubBanned(String(i.question)), answer: scrubBanned(String(i.answer)) }))
      if (items.length === 0) return NextResponse.json({ error: 'No FAQ generated — try again.' }, { status: 502 })
      const block = renderFaqBlock(items)
      // Insert before a "Related reviews" block if present, else append.
      const relIdx = content.search(/<!-- wp:heading -->\s*<h2>\s*Related reviews/i)
      content = relIdx !== -1 ? content.slice(0, relIdx) + block + content.slice(relIdx) : content + block
    }

    // Push to WordPress + persist.
    await wpService.updatePost(post.wordpress_post_id, { content } as never)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('blog_posts').update({ content }).eq('id', post.id)

    // Re-score and refresh the cache so the UI reflects the fix immediately.
    const host = wpBase
    const { score, checks } = scorePostSeo({ title: post.title || '', contentHtml: content, siteHost: host, postType: post.post_type || 'review' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { await (supabase as any).from('post_seo').update({ seo_score: score, score_detail: checks, checked_at: new Date().toISOString() }).eq('post_id', post.id) } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true, fix, score })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fix failed' }, { status: 500 })
  }
}
