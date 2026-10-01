// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// PRICES TAKEN OFF POSTS ALREADY LIVE.
//
// Amazon's Associates policy 2(b): a page may show a price only when Amazon
// serves it or it comes from Amazon's own API with a time stamp, and a
// discount only while the promotion lasts. New posts carry neither (see
// scripts/test-no-published-prices). This removes what older ones printed:
//
//   Weekly Deal Digest  the "$59.99 $89.99 · about 33% off" line under each deal
//   Idea lists          the "$24.99 · 4.5★ (1,234)" line on each card
//   Deals Hub excerpt   "Save $47 (~32%) on ..." (it lives only in WordPress)
//
// Only those lines change; nothing else in a post is touched. Each write goes
// to the post's own site after checking it is the same post, like every other
// repair here. A post that cannot be fixed is rotated to the back, reported,
// and cannot hold the others up.

import { createWordPressService } from '@/services/wordpress'
import { credsForPost, checkSamePost } from '@/lib/post-site'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export const PRICE_FIX_PER_RUN = 15

// The digest's price line, exactly as it was built.
const DIGEST_PRICE_LINE = /<p><strong>[$£€][\d.,]+<\/strong>(?:\s*<span style="text-decoration:line-through;color:#888">[$£€][\d.,]+<\/span>)?(?:\s*·\s*about \d+% off)?<\/p>\n?/g
// The idea-list card's price and stars line, exactly as it was built.
const IDEA_META_LINE = /<p style="margin:0 0 \.85rem;color:#555;">[^<]*<\/p>\n?/g

/** The post without its printed prices, or null when it has none. Pure. */
export function stripPublishedPrices(html: string): string | null {
  if (!html) return null
  const out = html
    .replace(DIGEST_PRICE_LINE, '')
    .replace(IDEA_META_LINE, '')
    .replace(/>See the deal on ([^<]+)<\/a>/g, '>Check today\'s price on $1</a>')
  return out === html ? null : out
}

/** A deal excerpt without its amounts, or null when it has none. Pure. */
export function cleanDealExcerpt(excerpt: string): string | null {
  const e = String(excerpt || '')
  const m = e.match(/^\s*Save (?:\$[\d.,]+ \(~\d+%\)|about \d+%) on (.+?)\.\s*([\s\S]*)$/)
  if (!m) return null
  const tail = m[2].replace('Limited-time pricing worth catching.', 'Check today\'s price before it changes.').trim()
  return `Deal alert on ${m[1]}.${tail ? ` ${tail}` : ''}`.slice(0, 250)
}

export type PriceSweepReport = { fixed: number; checked: number; failed: Array<{ postId: string; reason: string }> }

export async function sweepPublishedPrices(sb: Sb, max = PRICE_FIX_PER_RUN, deadline = Date.now() + 90_000): Promise<PriceSweepReport> {
  const out: PriceSweepReport = { fixed: 0, checked: 0, failed: [] }
  type Row = { id: string; user_id: string; content: string | null; wordpress_post_id: number; wordpress_url: string | null; wordpress_site_id: string | null; post_type?: string | null; deal_meta?: Record<string, unknown> | null; updated_at: string }
  const cols = 'id,user_id,content,wordpress_post_id,wordpress_url,wordpress_site_id,post_type,deal_meta,updated_at'
  const pick = (q: (x: Sb) => Sb) => q(sb.from('blog_posts').select(cols).not('wordpress_post_id', 'is', null))
    .order('updated_at', { ascending: true }).limit(max)
  const [digest, idea, deals] = await Promise.all([
    pick((x) => x.ilike('content', '%text-decoration:line-through;color:#888%')),
    pick((x) => x.ilike('content', '%margin:0 0 .85rem;color:#555;%')),
    // Deal posts whose excerpt has not been checked yet (deal_meta marks it).
    pick((x) => x.eq('post_type', 'deal').is('deal_meta->>excerpt_checked', null)),
  ])
  const byId = new Map<string, Row>()
  for (const r of [...(digest.data ?? []), ...(idea.data ?? []), ...(deals.data ?? [])] as Row[]) byId.set(r.id, r)
  const posts = [...byId.values()].sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at))).slice(0, max)
  const touch = (id: string) => sb.from('blog_posts').update({ updated_at: new Date().toISOString() }).eq('id', id)

  for (const p of posts) {
    if (Date.now() > deadline) break
    out.checked++
    try {
      const site = await credsForPost(sb, p.user_id, p)
      if (!site) { out.failed.push({ postId: p.id, reason: 'no site credentials' }); await touch(p.id); continue }
      const wp = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)
      const same = await checkSamePost(wp, p.wordpress_post_id, p.wordpress_url)
      if (!same.ok) { out.failed.push({ postId: p.id, reason: same.error }); await touch(p.id); continue }

      const patch: Record<string, unknown> = {}
      const raw = await wp.readRawPost(p.wordpress_post_id)
      if (!raw.ok) { out.failed.push({ postId: p.id, reason: raw.reason }); await touch(p.id); continue }
      const live = stripPublishedPrices(raw.content)
      if (live) patch.content = live
      if (p.post_type === 'deal') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ex = await (wp as any).getCustomEndpoint(`/wp/v2/posts/${p.wordpress_post_id}?context=edit&_fields=excerpt`).catch(() => null) as { excerpt?: { raw?: string } } | null
        const cleaned = cleanDealExcerpt(String(ex?.excerpt?.raw ?? ''))
        if (cleaned) patch.excerpt = cleaned
      }
      if (Object.keys(patch).length) await wp.updatePost(p.wordpress_post_id, patch)

      const ours = stripPublishedPrices(String(p.content || ''))
      const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (ours) dbPatch.content = ours
      if (p.post_type === 'deal') dbPatch.deal_meta = { ...(p.deal_meta ?? {}), excerpt_checked: true }
      await sb.from('blog_posts').update(dbPatch).eq('id', p.id)
      out.fixed++
    } catch (e) {
      out.failed.push({ postId: p.id, reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
      await touch(p.id)
    }
  }
  return out
}

// ── THE PRICE IN THE REVIEW DATA ────────────────────────────────────────────
//
// Every published post's review data (the mvp_jsonld meta MVP writes, which
// Google and the site's products feed read) used to carry the Amazon price.
// New posts have none. This takes it out of the rest, on every account, in the
// background: the offer stays (where to buy, availability), only price,
// priceCurrency and priceValidUntil go. Words like "on sale" are not touched.
// Each post is marked when looked at (migration 392), so it is read once.

export const SCHEMA_FIX_PER_RUN = 20

/** The review data without a price, or null when it has none. Pure. */
export function stripSchemaPrice(json: string | null | undefined): string | null {
  if (!json) return null
  let graph: { '@graph'?: Array<Record<string, unknown>> } & Record<string, unknown>
  try { graph = JSON.parse(json) } catch { return null }
  let changed = false
  const nodes = Array.isArray(graph['@graph']) ? graph['@graph'] : [graph]
  for (const node of nodes) {
    const offers = node?.offers
    for (const offer of (Array.isArray(offers) ? offers : offers ? [offers] : []) as Array<Record<string, unknown>>) {
      for (const k of ['price', 'priceCurrency', 'priceValidUntil', 'lowPrice', 'highPrice']) {
        if (k in offer) { delete offer[k]; changed = true }
      }
      if (offer.priceSpecification) { delete offer.priceSpecification; changed = true }
    }
  }
  return changed ? JSON.stringify(graph) : null
}

export type SchemaSweepReport = { fixed: number; checked: number; failed: Array<{ postId: string; reason: string }>; error?: string }

export async function sweepSchemaPrices(sb: Sb, max = SCHEMA_FIX_PER_RUN, deadline = Date.now() + 90_000): Promise<SchemaSweepReport> {
  const out: SchemaSweepReport = { fixed: 0, checked: 0, failed: [] }
  const { data, error } = await sb.from('blog_posts')
    .select('id,user_id,wordpress_post_id,wordpress_url,wordpress_site_id,updated_at')
    .is('schema_price_checked_at', null).not('wordpress_post_id', 'is', null)
    .order('created_at', { ascending: false }).limit(max)
  if (error) return { ...out, error: /schema_price_checked_at/.test(String(error.message)) ? 'Migration 392 has not been run.' : String(error.message) }
  const mark = (id: string) => sb.from('blog_posts').update({ schema_price_checked_at: new Date().toISOString() }).eq('id', id)

  for (const p of (data ?? []) as Array<{ id: string; user_id: string; wordpress_post_id: number; wordpress_url: string | null; wordpress_site_id: string | null }>) {
    if (Date.now() > deadline) break
    out.checked++
    try {
      const site = await credsForPost(sb, p.user_id, p)
      // A post on a site MVP can no longer reach is marked too: there is
      // nothing to fix from here, and it must not hold the queue.
      if (!site) { out.failed.push({ postId: p.id, reason: 'no site credentials' }); await mark(p.id); continue }
      const wp = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)
      const same = await checkSamePost(wp, p.wordpress_post_id, p.wordpress_url)
      if (!same.ok) { out.failed.push({ postId: p.id, reason: same.error }); await mark(p.id); continue }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = await (wp as any).getCustomEndpoint(`/wp/v2/posts/${p.wordpress_post_id}?context=edit&_fields=meta`).catch(() => null) as { meta?: { mvp_jsonld?: string } } | null
      const cleaned = stripSchemaPrice(meta?.meta?.mvp_jsonld)
      if (cleaned) { await wp.updatePost(p.wordpress_post_id, { meta: { mvp_jsonld: cleaned } }); out.fixed++ }
      await mark(p.id)
    } catch (e) {
      // Marked and reported, so one broken post cannot hold the queue; the
      // run's answer lists it.
      out.failed.push({ postId: p.id, reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
      await mark(p.id)
    }
  }
  return out
}
