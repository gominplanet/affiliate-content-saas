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
import { findSales } from '@/lib/covered-sales'
import {
  parseDealEnd, dealState, lastingTitle, lastingExcerpt, markShortcodesEnded, rewriteIsSafe, dealPhase,
  reviveShortcodes, firstProductHref, saleAgainExcerpt, type DealState, type DealPhase,
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
  /** deal (as written), lasting (sale taken out), revived (on sale again). */
  phase: DealPhase
  /** The discount at the latest price check, when on sale. */
  salePct: number | null
  /** What the last conversion did, step by step. */
  aftercare: AftercareReport | null
  /** What bringing the deal back did. */
  revive: ReviveReport | null
}

export interface ReviveReport {
  at: string
  pct: number | null
  endsAt: string | null
  boxes: 'restored' | 'added' | 'none'
  auto: boolean
}

type SaleCheck = { state?: DealState; at?: string; pct?: number | null; endsAt?: string | null }

export interface AftercareReport {
  at: string
  /** Done by the automatic job rather than a press. */
  auto?: boolean
  boxes: 'ended' | 'already' | 'none'
  article: 'rewritten' | 'already' | 'kept' | 'skipped'
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
  const phase = dealPhase(m as { endedAt?: unknown; revivedAt?: unknown })
  // A deal brought back runs on its NEW end date (a lightning deal's) or on
  // price checks, never the original one, which is in the past and would end
  // it again the moment it came back.
  const endAt = phase === 'revived'
    ? parseDealEnd(m.revivedEndsAt, p.published_at || p.created_at)
    : parseDealEnd(m.dealEndsAt, p.published_at || p.created_at)
  const check = m.saleCheck as SaleCheck | undefined
  const checkedAt = Date.parse(String(check?.at || '')) || 0
  // A check made before the post's last change says nothing about it now.
  const since = Math.max(Date.parse(String(m.endedAt || '')) || 0, Date.parse(String(m.revivedAt || '')) || 0)
  const fresh = checkedAt && now - checkedAt < CHECK_FRESH_HOURS * 3_600_000 && checkedAt >= since ? check?.state ?? null : null
  const { state, why } = phase === 'lasting'
    // A lasting review has no deal to end. The question is only whether the
    // product is on sale again.
    ? (fresh === 'on' ? { state: 'on' as DealState, why: 'On sale again at the latest price check.' }
      : fresh === 'ended' ? { state: 'ended' as DealState, why: 'Not on sale at the latest price check.' }
        : { state: 'unknown' as DealState, why: 'Not checked since it became a lasting review.' })
    : dealState({ endAt, now, priceCheck: fresh })
  return {
    id: p.id, title: String(p.title || ''), url: p.wordpress_url, asin, publishedAt: p.published_at || p.created_at,
    endAt: endAt ? endAt.toISOString() : null, state, why,
    convertedAt: (m.endedAt as string) || null, phase,
    salePct: fresh === 'on' && typeof check?.pct === 'number' ? check.pct : null,
    aftercare: (m.aftercare as AftercareReport) || null, revive: (m.revive as ReviveReport) || null,
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

/**
 * Is each product on sale right now, and by how much? Fresh prices only (deal
 * rows under 8 hours, Keepa under 6). A product nobody could check is
 * 'unknown', never 'ended' and never 'on'.
 */
export async function saleCheck(admin: Sb, asins: string[], keepaCap = CHECK_MAX): Promise<Map<string, { state: DealState; pct: number | null; endsAt: string | null }>> {
  const out = new Map<string, { state: DealState; pct: number | null; endsAt: string | null }>()
  const unique = [...new Set(asins.map((a) => a.toUpperCase()))]
  if (!unique.length) return out
  let checked: string[] = []
  const on = await findSales(admin, unique.map((asin) => ({ asin, title: asin, image: null, sources: [] })), {
    keepaCap, keepaMaxAgeDays: 0.25, dealMaxAgeHours: 8, onStats: (st) => { checked = st.checkedAsins },
  })
  const onMap = new Map(on.map((p) => [p.asin.toUpperCase(), p.verdict]))
  const checkedSet = new Set(checked.map((a) => a.toUpperCase()))
  for (const a of unique) {
    const v = onMap.get(a)
    out.set(a, v ? { state: 'on', pct: v.pct, endsAt: v.lightningEndsAt } : { state: checkedSet.has(a) ? 'ended' : 'unknown', pct: null, endsAt: null })
  }
  return out
}

/** Which posts a price check would tell something new. */
export function needsPriceCheck(p: DealPostRow): boolean {
  if (p.phase === 'lasting') return p.state === 'unknown'
  if (p.state === 'ended') return false
  // A deal with a future end date runs on its date.
  if (p.endAt && Date.parse(p.endAt) > Date.now()) return false
  return p.state === 'unknown'
}

/** A fresh price check for the posts that need one. Kept on the post. */
export async function checkDealPrices(sb: Sb, ownerId: string, cap = CHECK_MAX): Promise<{ checked: number; ended: number; on: number; unknown: number; left: number }> {
  const { posts } = await listDealPosts(sb, ownerId)
  const need = posts.filter(needsPriceCheck)
  const batch = need.slice(0, cap)
  const verdict = await saleCheck(sb, batch.map((p) => p.asin), cap)
  const at = new Date().toISOString()
  let ended = 0, on = 0, unknown = 0
  for (const p of batch) {
    const v = verdict.get(p.asin) ?? { state: 'unknown' as DealState, pct: null, endsAt: null }
    if (v.state === 'ended') ended++; else if (v.state === 'on') on++; else unknown++
    const { data } = await sb.from('blog_posts').select('deal_meta').eq('id', p.id).maybeSingle()
    await sb.from('blog_posts').update({ deal_meta: { ...(data?.deal_meta || {}), saleCheck: { state: v.state, pct: v.pct, endsAt: v.endsAt, at } } }).eq('id', p.id)
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
export async function convertDealPost(sb: Sb, ownerId: string, postId: string, opts: { force?: boolean; auto?: boolean } = {}): Promise<ConvertResult> {
  const { data: p } = await sb.from('blog_posts')
    .select('id, title, wordpress_url, wordpress_post_id, wordpress_site_id, published_at, created_at, deal_meta')
    .eq('id', postId).eq('user_id', ownerId).eq('post_type', 'deal').maybeSingle()
  const row = p ? rowOf(p as PostDb) : null
  if (!p || !row) return { ok: false, error: 'That deal post was not found.' }
  if (row.phase === 'lasting') return { ok: false, error: 'Not changed: it is already a lasting review.' }
  if (row.state !== 'ended' && !opts.force) return { ok: false, error: `Not changed: ${row.why} Its sale wording is still true.` }
  // A deal that came back and ended again: the article was made lasting the
  // first time, so only the boxes and the intro change now. No second rewrite.
  const priorReport = ((p.deal_meta as Record<string, unknown>)?.aftercare as AftercareReport | undefined) || null
  const articleAlreadyLasting = priorReport?.article === 'rewritten' || priorReport?.article === 'already'

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
  if (articleAlreadyLasting) { article = 'already' } else try {
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
    at, auto: !!opts.auto,
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

export type ReviveResult = { ok: true; report: ReviveReport } | { ok: false; error: string }

/**
 * Bring the deal back on a lasting review whose product is on sale again:
 * the deal boxes show the new discount (with a countdown when it is a
 * lightning deal) and the intro says it is on sale again. The article and the
 * title stay the lasting review. Only on a fresh price check that found a sale.
 */
export async function reviveDealPost(sb: Sb, ownerId: string, postId: string, opts: { auto?: boolean } = {}): Promise<ReviveResult> {
  const { data: p } = await sb.from('blog_posts')
    .select('id, title, wordpress_url, wordpress_post_id, wordpress_site_id, published_at, created_at, deal_meta')
    .eq('id', postId).eq('user_id', ownerId).eq('post_type', 'deal').maybeSingle()
  const row = p ? rowOf(p as PostDb) : null
  if (!p || !row) return { ok: false, error: 'That deal post was not found.' }
  if (row.phase !== 'lasting') return { ok: false, error: row.phase === 'revived' ? 'Not changed: its deal is already back.' : 'Not changed: it was never made a lasting review, so its deal is still in it.' }
  if (row.state !== 'on') return { ok: false, error: `Not changed: ${row.why}` }
  const check = ((p.deal_meta as Record<string, unknown>)?.saleCheck as SaleCheck | undefined) || {}
  const pct = typeof check.pct === 'number' ? check.pct : null
  const endsAt = check.endsAt && Date.parse(check.endsAt) > Date.now() ? check.endsAt : null

  const site = await getWordPressCredentials(sb, ownerId, (p.wordpress_site_id as string | null) || undefined)
  if (!site) return { ok: false, error: 'WordPress is not connected, so nothing was changed.' }
  const wp = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)
  const current = await wp.getPostContent(p.wordpress_post_id as number)
  if (!current) return { ok: false, error: 'MVP could not read the post from WordPress, so nothing was changed.' }

  let html = current.content
  let boxes: ReviveReport['boxes'] = 'none'
  if (/\[mvp_deal_banner\b/i.test(html)) {
    html = reviveShortcodes(html, { pct, endsAt }).html
    boxes = 'restored'
  } else {
    // A post that never had a deal box gets one at the top, pointing where
    // the article already sends people.
    const href = firstProductHref(html)
    if (href) {
      const badge = pct != null && pct > 0 ? `${Math.round(pct)}% OFF` : 'DEAL'
      html = `[mvp_deal_banner badge="${badge}" url="${href}"${endsAt ? ` end_date="${endsAt}"` : ''}]\n\n${html}`
      boxes = 'added'
    }
  }
  if (boxes === 'none') return { ok: false, error: 'Not changed: the post has no deal box and no product link to build one from.' }
  const excerpt = saleAgainExcerpt(pct, current.title.replace(/\s+Review$/i, ''))

  try {
    await wp.updatePost(p.wordpress_post_id as number, { content: html, excerpt, meta: { mvp_meta_description: excerpt } } as Parameters<typeof wp.updatePost>[1])
  } catch (e) {
    return { ok: false, error: `WordPress did not take the change, so the post is as it was: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}` }
  }
  const at = new Date().toISOString()
  const report: ReviveReport = { at, pct, endsAt, boxes, auto: !!opts.auto }
  await sb.from('blog_posts').update({
    content: html,
    deal_meta: { ...((p.deal_meta as Record<string, unknown>) || {}), revivedAt: at, revivedEndsAt: endsAt, revive: report },
  }).eq('id', p.id)
  return { ok: true, report }
}

/** One automatic pass for one creator. Bounded: the AI rewrite and the
 *  WordPress edits are slow, so a run does a few and the next run does more. */
export interface AutoRunResult {
  checked: number
  converted: Array<{ id: string; title: string }>
  revived: Array<{ id: string; title: string; pct: number | null }>
  failed: Array<{ id: string; title: string; error: string }>
}

export async function runAftercareForOwner(sb: Sb, ownerId: string, limits: { checks: number; converts: number; revives: number; deadline: number }): Promise<AutoRunResult> {
  const out: AutoRunResult = { checked: 0, converted: [], revived: [], failed: [] }
  // 1. Price checks for posts whose answer is not known yet.
  if (limits.checks > 0) {
    const r = await checkDealPrices(sb, ownerId, limits.checks)
    out.checked = r.checked
  }
  const { posts } = await listDealPosts(sb, ownerId)
  // 2. Deals that ended: made lasting reviews.
  for (const p of posts.filter((x) => x.phase !== 'lasting' && x.state === 'ended').slice(0, limits.converts)) {
    if (Date.now() > limits.deadline) break
    const r = await convertDealPost(sb, ownerId, p.id, { auto: true })
    if (r.ok) out.converted.push({ id: p.id, title: p.title })
    else out.failed.push({ id: p.id, title: p.title, error: r.error })
  }
  // 3. Lasting reviews on sale again: deal brought back.
  for (const p of posts.filter((x) => x.phase === 'lasting' && x.state === 'on').slice(0, limits.revives)) {
    if (Date.now() > limits.deadline) break
    const r = await reviveDealPost(sb, ownerId, p.id, { auto: true })
    if (r.ok) out.revived.push({ id: p.id, title: p.title, pct: r.report.pct })
    else out.failed.push({ id: p.id, title: p.title, error: r.error })
  }
  return out
}
