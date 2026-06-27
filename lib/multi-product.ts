// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Multi-product enrichment for single-video reviews.
//
// The standard blog generator resolves + links ONE product per video. But many
// videos ("full face routine", "haul", "my 5 favourites") review SEVERAL
// products — and the creator should earn on every one, not just the hero.
//
// This runs as a best-effort post-process on the finished post body: it reads
// the transcript, extracts the OTHER products discussed, gives each its own
// affiliate link (the creator's tag, or a Geniuslink cloak), links the first
// mention of each in the prose, and appends a "Shop everything in this video"
// recap box. Single-product videos are a no-op. The caller wraps this in a
// try/catch — any failure leaves the normal single-product post untouched.

import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { scrubBanned } from '@/lib/scrub'
import { createGeniuslinkService } from '@/services/geniuslink'

const REL = 'nofollow sponsored noopener'

export interface MultiProductOpts {
  content: string
  transcript: string
  videoTitle: string
  /** The hero product already resolved + linked by the main flow — excluded
   *  from the extras so we don't double-link it. */
  primaryName: string | null
  primaryUrl: string | null
  amazonTag?: string | null
  geniuslinkKey?: string | null
  geniuslinkSecret?: string | null
  userId?: string | null
  tier?: string | null
}

interface ExtractedProduct { name: string; shortName: string }
interface LinkedProduct extends ExtractedProduct { url: string }

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function norm(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Same product? Tolerant: exact-ish or one name contains the other's core. */
function sameProduct(a: string, b: string): boolean {
  const na = norm(a), nb = norm(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

/** Link the FIRST plain-text mention of `name` — skipping matches that fall
 *  inside an HTML tag or an existing <a> (so we never break markup or
 *  double-link). Returns the html unchanged if no safe match exists. */
function linkFirstMention(html: string, name: string, url: string): string {
  if (!html || !name || !url) return html
  const lower = html.toLowerCase()
  const target = name.toLowerCase()
  let from = 0
  for (;;) {
    const idx = lower.indexOf(target, from)
    if (idx === -1) return html
    const insideTag = html.lastIndexOf('<', idx) > html.lastIndexOf('>', idx)
    const insideAnchor = lower.lastIndexOf('<a', idx) > lower.lastIndexOf('</a>', idx)
    if (!insideTag && !insideAnchor) {
      const actual = html.slice(idx, idx + name.length)
      return `${html.slice(0, idx)}<a href="${url}" target="_blank" rel="${REL}">${actual}</a>${html.slice(idx + name.length)}`
    }
    from = idx + name.length
  }
}

/** Ask Haiku for the distinct REAL products reviewed in the transcript. */
async function extractProducts(opts: MultiProductOpts): Promise<ExtractedProduct[]> {
  const plain = opts.transcript.replace(/\s+/g, ' ').trim().slice(0, 9000)
  const client = createAnthropicClient()
  const resp = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 700,
    system: 'You extract the distinct, real, purchasable products a video review actually discusses. Never invent products; only list ones clearly named in the transcript.',
    messages: [{
      role: 'user',
      content: `From this product-review video, list every DISTINCT physical product that is actually reviewed, used, or recommended. Skip generic categories, ingredients, and anything not a buyable product.

For each, return:
- "name": the full product name including brand (good for an Amazon search)
- "shortName": the shortest phrase a reader would recognise it by in the prose (used to find its first mention to link)

Return ONLY a JSON array, max 10 items, most-featured first. No prose.

TITLE: ${opts.videoTitle}

TRANSCRIPT:
${plain}`,
    }],
  })
  recordAnthropicUsage(resp, { userId: opts.userId, tier: opts.tier, feature: 'blog_multiproduct_extract', model: 'claude-haiku-4-5-20251001' })
  const text = (resp.content.find(b => b.type === 'text') as { text?: string } | undefined)?.text || ''
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const arr = JSON.parse(match[0]) as Array<{ name?: string; shortName?: string }>
    return arr
      .map(p => ({ name: scrubBanned(String(p?.name || '')).trim(), shortName: scrubBanned(String(p?.shortName || p?.name || '')).trim() }))
      .filter(p => p.name.length >= 3 && p.shortName.length >= 2)
      .slice(0, 10)
  } catch { return [] }
}

/** An affiliate link for a product NAME: Geniuslink-cloaked Amazon search when
 *  Geniuslink is configured (branded + tracked), else a tagged Amazon search.
 *  Returns null if we can't monetise it (no tag and no Geniuslink). */
async function resolveLink(
  name: string,
  amazonTag: string | null | undefined,
  genius: ReturnType<typeof createGeniuslinkService> | null,
): Promise<string | null> {
  const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(name)}`
  // Tagged search first — instant + robust + monetised (the common case).
  if (amazonTag) return `${searchUrl}&tag=${amazonTag}`
  // No Amazon tag but Geniuslink is set up → cloak the search so it still
  // carries the creator's attribution.
  if (genius) {
    try { return await genius.createLink(searchUrl, name) } catch { /* fall through */ }
  }
  return null
}

/** "Shop everything in this video" recap — every product as a tidy row with its
 *  own buy link. Primary first, then the extras. Gutenberg-safe block markup. */
function renderShopEverything(primary: { name: string; url: string } | null, extras: LinkedProduct[]): string {
  const rows: string[] = []
  const row = (label: string, url: string) =>
    `<!-- wp:paragraph --><p style="margin:6px 0">🛍️ <strong>${esc(label)}</strong> — <a href="${url}" target="_blank" rel="${REL}">check price on Amazon →</a></p><!-- /wp:paragraph -->`
  if (primary) rows.push(row(primary.name, primary.url))
  for (const e of extras) rows.push(row(e.name, e.url))
  if (rows.length === 0) return ''
  return (
    `\n<!-- wp:heading --><h2>🛍️ Shop everything in this video</h2><!-- /wp:heading -->\n` +
    `<!-- wp:paragraph --><p>Every product mentioned, in one place — these are affiliate links, so I may earn a small commission at no extra cost to you.</p><!-- /wp:paragraph -->\n` +
    rows.join('\n')
  )
}

/** Best-effort: link every product reviewed in a multi-product video + add the
 *  recap box. No-op (returns content unchanged) for single-product videos or
 *  when nothing can be monetised. */
export async function enrichMultiProductLinks(opts: MultiProductOpts): Promise<{ content: string; productsLinked: number }> {
  const { content, transcript, primaryName, primaryUrl, amazonTag } = opts
  if (!transcript || transcript.trim().length < 200) return { content, productsLinked: 0 }
  // Idempotent: if a previous run already added the recap (e.g. a rebuild),
  // don't stack a second one.
  if (content.includes('Shop everything in this video')) return { content, productsLinked: 0 }

  const genius = (opts.geniuslinkKey && opts.geniuslinkSecret)
    ? createGeniuslinkService(opts.geniuslinkKey, opts.geniuslinkSecret)
    : null
  // Can't monetise without a tag or Geniuslink → leave the post as-is.
  if (!amazonTag && !genius) return { content, productsLinked: 0 }

  const all = await extractProducts(opts)
  // Drop the hero product (already linked) + de-dupe.
  const seen = new Set<string>()
  const extras = all.filter(p => {
    if (primaryName && sameProduct(p.name, primaryName)) return false
    const k = norm(p.name)
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, 8)
  if (extras.length === 0) return { content, productsLinked: 0 }  // single-product video

  // Resolve all links in parallel (each falls back to tagged search instantly).
  const resolved = (await Promise.all(extras.map(async (p): Promise<LinkedProduct | null> => {
    const url = await resolveLink(p.name, amazonTag, genius)
    return url ? { ...p, url } : null
  }))).filter((p): p is LinkedProduct => p !== null)
  if (resolved.length === 0) return { content, productsLinked: 0 }

  // Inline-link the first mention of each, then append the recap.
  let out = content
  for (const p of resolved) out = linkFirstMention(out, p.shortName || p.name, p.url)
  out += renderShopEverything(primaryName && primaryUrl ? { name: primaryName, url: primaryUrl } : null, resolved)
  return { content: out, productsLinked: resolved.length }
}
