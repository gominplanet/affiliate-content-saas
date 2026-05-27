/**
 * POST /api/seo/fix  { postId, fix }
 *
 * The "MVP doesn't just tell you — it fixes it" action. Applies SEO fixes to a
 * published post and republishes to WordPress in ONE pass, then re-scores.
 *   fix = 'internal_links' | 'faq' | 'title_length' | 'image_alt' — one fix
 *   fix = 'all'  — apply every applicable fix for the post's FAILING checks
 * 'all' runs the failing fixers, skipping any that don't apply; single-fix mode
 * returns a friendly reason when nothing was changed.
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

type FixType = 'internal_links' | 'faq' | 'title_length' | 'image_alt'
const SINGLE_FIXES: FixType[] = ['internal_links', 'faq', 'title_length', 'image_alt']

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

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

  const { postId, fix } = (await request.json().catch(() => ({}))) as { postId?: string; fix?: FixType | 'all' }
  if (!postId || !fix || (fix !== 'all' && !SINGLE_FIXES.includes(fix as FixType))) {
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
  const postType = (post.post_type as string) || 'review'

  // Mutable working copy. Each fixer mutates this + reports whether it applied.
  const state = { title: (post.title as string) || '', content: post.content as string }
  type FixResult = { applied: boolean; reason?: string }

  const applyTitle = async (): Promise<FixResult> => {
    if (state.title.length <= 65) return { applied: false, reason: 'Title is short — expand it manually so we don’t fabricate.' }
    const client = createAnthropicClient()
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 60,
      messages: [{ role: 'user', content: `Shorten this product-review blog title to 60 characters or fewer for SEO. Keep the exact product name and the main hook; do not invent anything; no surrounding quotes. Return ONLY the new title.\n\nTitle: ${state.title}` }],
    })
    recordAnthropicUsage(resp, { userId: user.id, tier: wp?.tier, feature: 'seo_fix_title', model: 'claude-haiku-4-5-20251001' })
    let next = scrubBanned((resp.content[0] as { type: string; text: string }).text || '').trim().replace(/^["']+|["']+$/g, '')
    if (!next || next.length > 65) next = state.title.slice(0, 60).replace(/\s+\S*$/, '').trim()
    if (!next || next === state.title) return { applied: false, reason: 'Could not shorten the title — try again.' }
    state.title = next
    return { applied: true }
  }

  const applyInternalLinks = async (): Promise<FixResult> => {
    if (/<h2>\s*Related reviews/i.test(state.content)) return { applied: false, reason: 'Already has a related-reviews block.' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: others } = await (supabase as any)
      .from('blog_posts').select('title,slug,seo_keyword')
      .eq('user_id', user.id).not('wordpress_post_id', 'is', null).neq('id', postId).limit(200)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidates: LinkCandidate[] = ((others ?? []) as any[])
      .filter(o => o.title && o.slug)
      .map(o => ({ title: o.title as string, url: `${wpBase}/${o.slug}`, keyword: o.seo_keyword || undefined }))
    const related = pickRelatedPosts({ title: state.title, keyword: post.seo_keyword || undefined }, candidates, 3)
    if (related.length === 0) return { applied: false, reason: 'No related posts to link to yet — publish a few more on similar topics first.' }
    state.content = insertRelatedLinks(state.content, renderRelatedLinksBlock(related))
    return { applied: true }
  }

  const applyImageAlt = async (): Promise<FixResult> => {
    const altBase = (state.title || 'product').replace(/<[^>]+>/g, '').slice(0, 110).replace(/"/g, '&quot;')
    let added = 0
    state.content = state.content.replace(/<img\b[^>]*>/gi, (tag) => {
      if (/\balt\s*=\s*["'][^"']+["']/i.test(tag)) return tag
      added++
      const cleaned = tag.replace(/\s+alt\s*=\s*["']\s*["']/i, '')
      return cleaned.replace(/<img\b/i, `<img alt="${altBase}"`)
    })
    return added > 0 ? { applied: true } : { applied: false, reason: 'No images need alt text on this post.' }
  }

  const applyFaq = async (): Promise<FixResult> => {
    if (/<h2[^>]*>\s*Frequently Asked Questions/i.test(state.content)) return { applied: false, reason: 'Already has an FAQ.' }
    const plain = state.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000)
    const client = createAnthropicClient()
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1200,
      messages: [{ role: 'user', content: `From this product review, write 4 genuinely useful FAQs a buyer would ask, answered ONLY from the review's own facts (never invent specs or claims). Each answer 1–2 sentences, first person where natural. Respond ONLY as JSON: [{"question":"...","answer":"..."}].\n\nReview:\n${plain}` }],
    })
    recordAnthropicUsage(resp, { userId: user.id, tier: wp?.tier, feature: 'seo_fix_faq', model: 'claude-haiku-4-5-20251001' })
    const match = (resp.content[0] as { type: string; text: string }).text.match(/\[[\s\S]*\]/)
    if (!match) return { applied: false, reason: 'Could not generate FAQ — try again.' }
    let items: { question: string; answer: string }[] = []
    try { items = JSON.parse(match[0]) } catch { return { applied: false, reason: 'FAQ format error — try again.' } }
    items = items.filter(i => i?.question && i?.answer).slice(0, 6)
      .map(i => ({ question: scrubBanned(String(i.question)), answer: scrubBanned(String(i.answer)) }))
    if (items.length === 0) return { applied: false, reason: 'No FAQ generated — try again.' }
    const block = renderFaqBlock(items)
    const relIdx = state.content.search(/<!-- wp:heading -->\s*<h2>\s*Related reviews/i)
    state.content = relIdx !== -1 ? state.content.slice(0, relIdx) + block + state.content.slice(relIdx) : state.content + block
    return { applied: true }
  }

  const fixers: Record<FixType, () => Promise<FixResult>> = {
    title_length: applyTitle,
    internal_links: applyInternalLinks,
    image_alt: applyImageAlt,
    faq: applyFaq,
  }

  try {
    // Decide what to run. 'all' → every failing check that has a fixer.
    let toRun: FixType[]
    if (fix === 'all') {
      const { checks } = scorePostSeo({ title: state.title, contentHtml: state.content, siteHost: wpBase, postType })
      toRun = checks.filter(c => !c.pass && (c.id in fixers)).map(c => c.id as FixType)
    } else {
      toRun = [fix as FixType]
    }

    const applied: string[] = []
    for (const f of toRun) {
      try {
        const r = await fixers[f]()
        if (r.applied) applied.push(f)
        else if (fix !== 'all') return NextResponse.json({ error: r.reason || 'Nothing to fix.' }, { status: 422 })
      } catch (e) {
        if (fix !== 'all') throw e   // surface the error in single-fix mode; skip in 'all'
      }
    }

    // Push only what changed to WordPress + persist.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wpUpdate: any = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbUpdate: any = {}
    if (state.content !== post.content) { wpUpdate.content = state.content; dbUpdate.content = state.content }
    if (state.title !== post.title) { wpUpdate.title = state.title; dbUpdate.title = state.title }
    if (Object.keys(wpUpdate).length) await wpService.updatePost(post.wordpress_post_id, wpUpdate as never)
    if (Object.keys(dbUpdate).length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('blog_posts').update(dbUpdate).eq('id', post.id)
    }

    const { score, checks } = scorePostSeo({ title: state.title, contentHtml: state.content, siteHost: wpBase, postType })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { await (supabase as any).from('post_seo').update({ seo_score: score, score_detail: checks, checked_at: new Date().toISOString() }).eq('post_id', post.id) } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true, fix, applied, score })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fix failed' }, { status: 500 })
  }
}
