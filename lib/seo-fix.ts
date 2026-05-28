// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared per-post SEO fix engine. Used by /api/seo/fix (single post) AND
// /api/seo/fix-all (whole catalog) so they apply identical fixes. Each fixer
// mutates a working {title, content} and reports whether it applied; we push
// only what changed to WordPress, then re-score.

import { pickRelatedPosts, renderRelatedLinksBlock, insertRelatedLinks, type LinkCandidate } from '@/lib/internal-links'
import { scorePostSeo } from '@/lib/seo-score'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { scrubBanned } from '@/lib/scrub'

export type SeoFixType = 'internal_links' | 'faq' | 'title_length' | 'image_alt'
export const SEO_FIX_TYPES: SeoFixType[] = ['internal_links', 'faq', 'title_length', 'image_alt']

export interface FixablePost {
  id: string
  title: string | null
  content: string | null
  slug: string | null
  seo_keyword: string | null
  post_type: string | null
  wordpress_post_id: number | null
}

export interface ApplyFixesResult {
  applied: SeoFixType[]
  reasons: Partial<Record<SeoFixType, string>>
  score: number
  changed: boolean
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderFaqBlock(items: { question: string; answer: string }[]): string {
  let out = '<!-- wp:heading --><h2>Frequently Asked Questions</h2><!-- /wp:heading -->'
  for (const it of items) {
    out += `<!-- wp:heading {"level":3} --><h3>${esc(it.question)}</h3><!-- /wp:heading -->`
    out += `<!-- wp:paragraph --><p>${esc(it.answer)}</p><!-- /wp:paragraph -->`
  }
  return out
}

/** Which checks are currently failing AND have a fixer that can actually
 *  fix them right now. Cheap — no network.
 *
 *  Subtle gotcha: title_length fails on titles BOTH under 30 chars
 *  (too short) AND over 65 (too long), but applyTitle() only knows how
 *  to SHORTEN — expanding a short title would mean fabricating. So we
 *  drop title_length from the fixable set when the title is short. The
 *  score still flags it for the dashboard; we just don't queue an
 *  impossible fix that would then bail with a confusing skip reason. */
export function fixableFailing(post: FixablePost, siteHost: string): SeoFixType[] {
  const title = post.title || ''
  const { checks } = scorePostSeo({ title, contentHtml: post.content || '', siteHost, postType: post.post_type || 'review' })
  return checks
    .filter(c => !c.pass && (SEO_FIX_TYPES as string[]).includes(c.id))
    .filter(c => !(c.id === 'title_length' && title.length <= 65))
    .map(c => c.id as SeoFixType)
}

export async function applyPostFixes(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  userId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wpService: { updatePost: (id: number, post: any) => Promise<unknown> }
  wpBase: string
  tier?: string | null
  post: FixablePost
  fixes: SeoFixType[] | 'all'
}): Promise<ApplyFixesResult> {
  const { supabase, userId, wpService, wpBase, tier, post } = opts
  const postType = post.post_type || 'review'
  const state = { title: post.title || '', content: post.content || '' }
  const reasons: Partial<Record<SeoFixType, string>> = {}

  const applyTitle = async (): Promise<boolean> => {
    // Auto-fixer can only shorten — expanding a short title would mean
    // inventing a hook/spec/year that wasn't in the source. Edit it
    // manually in WordPress (or regenerate the post from the source video).
    if (state.title.length <= 65) { reasons.title_length = 'Title is short — edit it manually in WordPress to add a hook (we don’t auto-expand to avoid fabricating).'; return false }
    const client = createAnthropicClient()
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 60,
      messages: [{ role: 'user', content: `Shorten this product-review blog title to 60 characters or fewer for SEO. Keep the exact product name and the main hook; do not invent anything; no surrounding quotes. Return ONLY the new title.\n\nTitle: ${state.title}` }],
    })
    recordAnthropicUsage(resp, { userId, tier, feature: 'seo_fix_title', model: 'claude-haiku-4-5-20251001' })
    let next = scrubBanned((resp.content[0] as { type: string; text: string }).text || '').trim().replace(/^["']+|["']+$/g, '')
    if (!next || next.length > 65) next = state.title.slice(0, 60).replace(/\s+\S*$/, '').trim()
    if (!next || next === state.title) { reasons.title_length = 'Could not shorten the title.'; return false }
    state.title = next; return true
  }

  const applyInternalLinks = async (): Promise<boolean> => {
    if (/<h2>\s*Related reviews/i.test(state.content)) { reasons.internal_links = 'Already has a related-reviews block.'; return false }
    // Pull title + slug + keyword + content + post_type so the matcher can
    // score on body text and same-post-type overlap, not just title overlap.
    // The token set in pickRelatedPosts was too narrow when both posts had
    // no seo_keyword and short titles — the body widens the signal.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: others } = await (supabase as any)
      .from('blog_posts').select('title,slug,seo_keyword,post_type,content')
      .eq('user_id', userId).not('wordpress_post_id', 'is', null).neq('id', post.id).limit(200)
    // Strip HTML + cap to first 800 chars per candidate — token-overlap math
    // doesn't benefit from more, and we want the candidate list to stay light.
    const stripSnippet = (html: string | null | undefined): string => {
      if (!html) return ''
      return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidates: LinkCandidate[] = ((others ?? []) as any[])
      .filter(o => o.title && o.slug)
      .map(o => ({
        title: o.title as string,
        url: `${wpBase}/${o.slug}`,
        keyword: o.seo_keyword || undefined,
        contentSnippet: stripSnippet(o.content as string | null),
        postType: (o.post_type as string | null) || undefined,
      }))
    const related = pickRelatedPosts({
      title: state.title,
      keyword: post.seo_keyword || undefined,
      contentSnippet: stripSnippet(state.content),
      postType: post.post_type || undefined,
    }, candidates, 3)
    if (related.length === 0) { reasons.internal_links = 'No related posts to link to yet.'; return false }
    state.content = insertRelatedLinks(state.content, renderRelatedLinksBlock(related)); return true
  }

  const applyImageAlt = async (): Promise<boolean> => {
    const altBase = (state.title || 'product').replace(/<[^>]+>/g, '').slice(0, 110).replace(/"/g, '&quot;')
    let added = 0
    state.content = state.content.replace(/<img\b[^>]*>/gi, (tag) => {
      if (/\balt\s*=\s*["'][^"']+["']/i.test(tag)) return tag
      added++
      return tag.replace(/\s+alt\s*=\s*["']\s*["']/i, '').replace(/<img\b/i, `<img alt="${altBase}"`)
    })
    if (added === 0) { reasons.image_alt = 'No images need alt text.'; return false }
    return true
  }

  const applyFaq = async (): Promise<boolean> => {
    if (/<h2[^>]*>\s*Frequently Asked Questions/i.test(state.content)) { reasons.faq = 'Already has an FAQ.'; return false }
    const plain = state.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000)
    const client = createAnthropicClient()
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1200,
      messages: [{ role: 'user', content: `From this product review, write 4 genuinely useful FAQs a buyer would ask, answered ONLY from the review's own facts (never invent specs or claims). Each answer 1–2 sentences, first person where natural. Respond ONLY as JSON: [{"question":"...","answer":"..."}].\n\nReview:\n${plain}` }],
    })
    recordAnthropicUsage(resp, { userId, tier, feature: 'seo_fix_faq', model: 'claude-haiku-4-5-20251001' })
    const match = (resp.content[0] as { type: string; text: string }).text.match(/\[[\s\S]*\]/)
    if (!match) { reasons.faq = 'Could not generate FAQ.'; return false }
    let items: { question: string; answer: string }[] = []
    try { items = JSON.parse(match[0]) } catch { reasons.faq = 'FAQ format error.'; return false }
    items = items.filter(i => i?.question && i?.answer).slice(0, 6).map(i => ({ question: scrubBanned(String(i.question)), answer: scrubBanned(String(i.answer)) }))
    if (items.length === 0) { reasons.faq = 'No FAQ generated.'; return false }
    const block = renderFaqBlock(items)
    const relIdx = state.content.search(/<!-- wp:heading -->\s*<h2>\s*Related reviews/i)
    state.content = relIdx !== -1 ? state.content.slice(0, relIdx) + block + state.content.slice(relIdx) : state.content + block
    return true
  }

  const fixers: Record<SeoFixType, () => Promise<boolean>> = {
    title_length: applyTitle, internal_links: applyInternalLinks, image_alt: applyImageAlt, faq: applyFaq,
  }

  const toRun: SeoFixType[] = opts.fixes === 'all' ? fixableFailing(post, wpBase) : opts.fixes
  const applied: SeoFixType[] = []
  for (const f of toRun) {
    try { if (await fixers[f]()) applied.push(f) } catch { reasons[f] = 'Fix errored.' }
  }

  // Persist only what changed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wpUpdate: any = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbUpdate: any = {}
  if (state.content !== (post.content || '')) { wpUpdate.content = state.content; dbUpdate.content = state.content }
  if (state.title !== (post.title || '')) { wpUpdate.title = state.title; dbUpdate.title = state.title }
  const changed = Object.keys(wpUpdate).length > 0
  if (changed && post.wordpress_post_id) await wpService.updatePost(post.wordpress_post_id, wpUpdate)
  if (Object.keys(dbUpdate).length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('blog_posts').update(dbUpdate).eq('id', post.id)
  }

  const { score, checks } = scorePostSeo({ title: state.title, contentHtml: state.content, siteHost: wpBase, postType })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  try { await (supabase as any).from('post_seo').update({ seo_score: score, score_detail: checks, checked_at: new Date().toISOString() }).eq('post_id', post.id) } catch { /* non-fatal */ }

  return { applied, reasons, score, changed }
}
