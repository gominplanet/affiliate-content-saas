// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// After the deal, the reads and the edit (lib/deal-aftercare.ts has the rules).
//
// list:     the creator's single-product deal posts, each with whether its
//           deal ended and why, and whether MVP already made it a lasting review
// check:    a fresh price check for posts with no passed end date (Keepa costs
//           tokens, so it runs when asked, capped, and the answer is kept)
// convert:  one post, in place, at the same address:
//             1. the deal boxes marked ended (the plugin shows the ended box)
//             2. the sale wording taken out of the article by one short AI
//                pass, published only if every link and box survived
//             3. a lasting title, intro and meta description
//           and what was done is saved on the post, step by step, so a step
//           that did not happen never reads as done.

import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { scrubBanned } from '@/lib/scrub'
import { salesNow } from '@/lib/sale-comments'
import {
  parseDealEnd, dealState, lastingTitle, lastingExcerpt, markShortcodesEnded, rewriteIsSafe, type DealState,
} from '@/lib/deal-aftercare'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

/** A price check older than this is not an answer any more. */
const CHECK_FRESH_HOURS = 72
/** Keepa tokens are shared by everyone; one press checks at most this many. */
export const CHECK_MAX = 40

export interface DealPostRow {
  id: string
  title: string
  url: string | null
  asin: string
  publishedAt: string | null
  endAt: string | null
  state: DealState
  why: string
  convertedAt: string | null
  /** What the last conversion did, step by step. */
  aftercare: AftercareReport | null
}

export interface AftercareReport {
  at: string
  boxes: 'ended' | 'already' | 'none'
  article: 'rewritten' | 'kept' | 'skipped'
  articleWhy: string | null
  title: { before: string; after: string } | null
  excerpt: boolean
  meta: boolean
}

type PostDb = { id: string; title: string | null; wordpress_url: string | null; wordpress_post_id: number | null; wordpress_site_id: string | null; published_at: string | null; created_at: string; deal_meta: Record<string, unknown> | null }

function rowOf(p: PostDb, now = Date.now()): DealPostRow | null {
  const m = p.deal_meta || {}
  const asin = String(m.asin || '').toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(asin)) return null
  const endAt = parseDealEnd(m.dealEndsAt, p.published_at || p.created_at)
  const check = m.saleCheck as { state?: DealState; at?: string } | undefined
  const fresh = check?.at && now - Date.parse(check.at) < CHECK_FRESH_HOURS * 3_600_000 ? check.state ?? null : null
  const { state, why } = dealState({ endAt, now, priceCheck: fresh })
  return {
    id: p.id, title: String(p.title || ''), url: p.wordpress_url, asin, publishedAt: p.published_at || p.created_at,
    endAt: endAt ? endAt.toISOString() : null, state, why,
    convertedAt: (m.endedAt as string) || null, aftercare: (m.aftercare as AftercareReport) || null,
  }
}

export async function listDealPosts(sb: Sb, ownerId: string): Promise<{ posts: DealPostRow[]; error: string | null }> {
  const { data, error } = await sb.from('blog_posts')
    .select('id, title, wordpress_url, wordpress_post_id, wordpress_site_id, published_at, created_at, deal_meta')
    .eq('user_id', ownerId).eq('post_type', 'deal').not('wordpress_post_id', 'is', null)
    .order('created_at', { ascending: false }).limit(500)
  if (error) return { posts: [], error: error.message }
  const posts = ((data ?? []) as PostDb[]).map((p) => rowOf(p)).filter(Boolean) as DealPostRow[]
  return { posts, error: null }
}

/** A fresh price check for the posts that need one. Kept on the post. */
export async function checkDealPrices(sb: Sb, ownerId: string): Promise<{ checked: number; ended: number; on: number; unknown: number; left: number }> {
  const { posts } = await listDealPosts(sb, ownerId)
  const need = posts.filter((p) => !p.convertedAt && p.state !== 'ended' && !(p.endAt && Date.parse(p.endAt) > Date.now()))
  const batch = need.slice(0, CHECK_MAX)
  const verdict = await salesNow(sb, batch.map((p) => p.asin))
  const at = new Date().toISOString()
  let ended = 0, on = 0, unknown = 0
  for (const p of batch) {
    const state = verdict.get(p.asin) ?? 'unknown'
    if (state === 'ended') ended++; else if (state === 'on') on++; else unknown++
    const { data } = await sb.from('blog_posts').select('deal_meta').eq('id', p.id).maybeSingle()
    await sb.from('blog_posts').update({ deal_meta: { ...(data?.deal_meta || {}), saleCheck: { state, at } } }).eq('id', p.id)
  }
  return { checked: batch.length, ended, on, unknown, left: Math.max(0, need.length - batch.length) }
}

const PROSE_PROMPT = (html: string) => `Below is the HTML of a published blog post that was written for a limited-time sale on this product. The sale has ENDED. Rewrite it so it reads as a lasting, honest review of the product that stays true for as long as the page is up. Change as little as possible.

RULES:
- Remove or rewrite every claim about the sale: discounts, "% off", "save", "deal", "limited time", "while it lasts", "act fast", countdowns, expiry dates, and "lowest price" claims. Do not say or imply it is on sale now.
- Where the post told the reader to grab the deal, say instead that they can check today's price.
- Link text like "See the deal on Amazon" becomes "Check the price on Amazon". Keep the link itself exactly as it is.
- Keep ALL HTML tags, attributes, links, images, and shortcodes (anything in [square brackets] like [mvp_deal_banner ...], [mvp_deal_cta ...]) EXACTLY as they are.
- Keep the product facts, the pros and cons, and the structure. Do not add sections. Do not invent anything.
- Do not use em dashes or en dashes. Do not mention the year. NEVER name a data provider or price tracker.
- Return the FULL updated HTML only, with no markdown fences.

HTML:
${html}`

export type ConvertResult =
  | { ok: true; report: AftercareReport; url: string | null }
  | { ok: false; error: string }

/** Turn one ended deal post into a lasting review, in place. */
export async function convertDealPost(sb: Sb, ownerId: string, postId: string, opts: { force?: boolean } = {}): Promise<ConvertResult> {
  const { data: p } = await sb.from('blog_posts')
    .select('id, title, wordpress_url, wordpress_post_id, wordpress_site_id, published_at, created_at, deal_meta')
    .eq('id', postId).eq('user_id', ownerId).eq('post_type', 'deal').maybeSingle()
  const row = p ? rowOf(p as PostDb) : null
  if (!p || !row) return { ok: false, error: 'That deal post was not found.' }
  if (row.state !== 'ended' && !opts.force) return { ok: false, error: `Not changed: ${row.why} Its sale wording is still true.` }

  const site = await getWordPressCredentials(sb, ownerId, (p.wordpress_site_id as string | null) || undefined)
  if (!site) return { ok: false, error: 'WordPress is not connected, so nothing was changed.' }
  const wp = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)
  const current = await wp.getPostContent(p.wordpress_post_id as number)
  if (!current) return { ok: false, error: 'MVP could not read the post from WordPress, so nothing was changed.' }

  // 1. The boxes.
  const marked = markShortcodesEnded(current.content)
  const hadBoxes = /\[mvp_deal_(banner|cta)\b/i.test(current.content)
  let html = marked.html

  // 2. The article. One short pass; published only if it kept everything.
  let article: AftercareReport['article'] = 'skipped'
  let articleWhy: string | null = null
  try {
    const client = createAnthropicClient()
    const msg = await client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 8000, messages: [{ role: 'user', content: PROSE_PROMPT(html) }] })
    recordAnthropicUsage(msg, { userId: ownerId, feature: 'deal_aftercare', model: 'claude-haiku-4-5-20251001' })
    const out = scrubBanned(((msg.content?.[0] as { text?: string })?.text || '').replace(/^```(?:html)?\s*|\s*```$/g, '').trim())
    const safe = rewriteIsSafe(html, out)
    if (safe.ok) { html = out; article = 'rewritten' }
    else { article = 'kept'; articleWhy = `The article text was left as it was because ${safe.why}. The deal boxes still show the deal ended.` }
  } catch (e) {
    article = 'kept'
    articleWhy = `The article text was left as it was because the rewrite failed (${(e instanceof Error ? e.message : String(e)).slice(0, 80)}). The deal boxes still show the deal ended.`
  }

  // 3. Title, intro, meta description.
  const productName = String((p.deal_meta as Record<string, unknown>)?.productTitle || current.title || p.title || '')
  const newTitle = lastingTitle(current.title || String(p.title || ''), productName)
  const excerpt = lastingExcerpt(productName || newTitle.replace(/\s+Review$/i, ''))

  try {
    await wp.updatePost(p.wordpress_post_id as number, {
      content: html, title: newTitle, excerpt,
      meta: { mvp_meta_description: excerpt },
    } as Parameters<typeof wp.updatePost>[1])
  } catch (e) {
    return { ok: false, error: `WordPress did not take the change, so the post is as it was: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}` }
  }

  const at = new Date().toISOString()
  const report: AftercareReport = {
    at,
    boxes: !hadBoxes ? 'none' : marked.changed ? 'ended' : 'already',
    article, articleWhy,
    title: newTitle !== current.title ? { before: current.title, after: newTitle } : null,
    excerpt: true, meta: true,
  }
  await sb.from('blog_posts').update({
    title: newTitle, content: html,
    deal_meta: { ...((p.deal_meta as Record<string, unknown>) || {}), endedAt: at, aftercare: report },
  }).eq('id', p.id)
  return { ok: true, report, url: p.wordpress_url as string | null }
}
