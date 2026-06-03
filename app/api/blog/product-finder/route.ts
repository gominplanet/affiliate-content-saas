// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AI Product Finder — public endpoint called from the customer's WordPress
// site by the JS widget that ships in the mvpaffiliate-platform plugin.
//
// Contract:
//   POST /api/blog/product-finder
//   body: { site: "https://mysite.com", q: "I need a sleep mask under $30" }
//   resp: { picks: Array<{ title, url, image, score, reason }>, brand: string|null }
//
// The widget runs in a customer's blog visitor's browser, so this endpoint
// is open + permissive CORS. There's no PII in the request or response, and
// the only data the response leaks is the customer's own published reviews
// (which are already public on their blog).
//
// Site identity:
//   We resolve the user_id from integrations.wordpress_url. The widget knows
//   the site URL because the plugin hard-codes it via `home_url('/')`. We
//   normalise (strip trailing slash, lowercase host) so https vs http and
//   www vs apex don't break the match.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'

export const maxDuration = 30
export const runtime = 'nodejs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

interface PickOut { title: string; url: string; image: string | null; score: number | null; reason: string }

/** Loose host-match so "https://site.com/" and "https://www.site.com" both
 *  resolve to the same integrations row. */
function hostKey(u: string): string {
  try {
    const { host } = new URL(u)
    return host.toLowerCase().replace(/^www\./, '')
  } catch { return '' }
}

export async function POST(req: Request) {
  let body: { site?: string; q?: string }
  try { body = await req.json() } catch { return cors({ error: 'Bad request' }, 400) }
  const site = (body.site || '').trim()
  const q = (body.q || '').trim()
  if (!site || !q) return cors({ error: 'Need site + q' }, 400)
  if (q.length > 300) return cors({ error: 'Query too long' }, 400)

  const wantHost = hostKey(site)
  if (!wantHost) return cors({ error: 'Bad site URL' }, 400)

  const admin = createAdminClient()

  // 1. Resolve user_id by matching host. We pull a small slice of integrations
  //    rows and host-match in JS — Postgres LIKE on a normalised host would
  //    work too but this is the lowest-risk version.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integRows } = await (admin as any)
    .from('integrations')
    .select('user_id, wordpress_url')
    .not('wordpress_url', 'is', null)
    .limit(1000)
  const match = (integRows ?? []).find((r: { wordpress_url: string }) => hostKey(r.wordpress_url) === wantHost)
  if (!match) return cors({ error: 'Site not registered' }, 404)
  const userId = match.user_id as string

  // 2. Brand name (for the widget's title — "Ask Gomin" etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brandRow } = await admin
    .from('brand_profiles')
    .select('name')
    .eq('user_id', userId)
    .maybeSingle()
  const brand = (brandRow?.name as string | null)?.trim() || null

  // 3. Build the catalogue from the LIVE WordPress REST API — that's the
  //    ground truth for "what's actually on this blog right now". Many of
  //    the user's reviews predate MVP or were authored directly in WP, so
  //    relying on blog_posts misses most of the catalogue. We also pull
  //    MVP's blog_posts for seo_keyword enrichment (richer Haiku context)
  //    and merge by URL.
  //
  //    Public WP REST needs no auth + works cross-origin (we're calling
  //    server-side anyway). _embed=wp:featuredmedia is the cheapest way to
  //    get featured images without a second per-post round-trip.
  type PostRow = { title: string; excerpt: string; url: string; image: string | null; seoKeyword: string | null }
  const posts = new Map<string, PostRow>() // keyed by stripped URL → row

  function stripUrl(u: string): string {
    return u.replace(/\/+$/, '').toLowerCase()
  }
  function stripHtml(s: string): string {
    return s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim()
  }

  // 3a. WP REST — primary source. Pull up to 100 posts (per_page max). If a
  //     site has more, the recent 100 covers what visitors typically ask.
  try {
    const wpBase = site.replace(/\/+$/, '')
    const wpRes = await fetch(`${wpBase}/wp-json/wp/v2/posts?per_page=100&_embed=wp:featuredmedia&_fields=link,title,excerpt,_links,_embedded`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    })
    if (wpRes.ok) {
      const wpPosts = await wpRes.json() as Array<{
        link: string
        title: { rendered: string }
        excerpt: { rendered: string }
        _embedded?: { 'wp:featuredmedia'?: Array<{ source_url?: string; media_details?: { sizes?: { medium?: { source_url?: string } } } }> }
      }>
      for (const p of wpPosts) {
        if (!p.link) continue
        const img = p._embedded?.['wp:featuredmedia']?.[0]
        posts.set(stripUrl(p.link), {
          title: stripHtml(p.title?.rendered || ''),
          excerpt: stripHtml(p.excerpt?.rendered || '').slice(0, 280),
          url: p.link,
          image: img?.media_details?.sizes?.medium?.source_url || img?.source_url || null,
          seoKeyword: null,
        })
      }
    }
  } catch {
    /* non-fatal — fall through to MVP-only catalogue */
  }

  // 3b. MVP blog_posts — enrichment pass. Patches seoKeyword onto matched
  //     rows so Haiku gets the buyer-search-phrase signal too.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: reviewsRaw } = await (admin as any)
    .from('blog_posts')
    .select('title, excerpt, wordpress_url, seo_keyword, video_id, youtube_videos(thumbnail_url)')
    .eq('user_id', userId)
    .eq('post_type', 'review')
    .not('wordpress_url', 'is', null)
    .limit(200)
  for (const r of (reviewsRaw ?? []) as Array<{ title: string; excerpt: string | null; wordpress_url: string; seo_keyword: string | null; youtube_videos: { thumbnail_url: string | null } | null }>) {
    const key = stripUrl(r.wordpress_url)
    const existing = posts.get(key)
    if (existing) {
      // Enrich the WP-sourced row with seo_keyword + better image fallback
      existing.seoKeyword = r.seo_keyword
      if (!existing.image && r.youtube_videos?.thumbnail_url) existing.image = r.youtube_videos.thumbnail_url
    } else {
      // MVP-only row (e.g. just-published, WP REST may have cached)
      posts.set(key, {
        title: r.title,
        excerpt: (r.excerpt || '').slice(0, 280),
        url: r.wordpress_url,
        image: r.youtube_videos?.thumbnail_url || null,
        seoKeyword: r.seo_keyword,
      })
    }
  }

  const reviews = Array.from(posts.values())
  if (reviews.length === 0) return cors({ picks: [], brand, reason: 'no_reviews' }, 200)

  // 4. Compact catalogue — Haiku doesn't need rich data, just enough to
  //    match the visitor's question to an existing post by title + excerpt.
  const catalogue = reviews.map((r, i) => `[${i}] ${r.title}${r.seoKeyword ? ` (kw: ${r.seoKeyword})` : ''}\n    ${r.excerpt}`).join('\n\n')

  const prompt = `You are an AI product finder for a review blog. The visitor asked:
"${q}"

Pick the 3 reviews from this catalogue that BEST match the visitor's intent. If fewer than 3 are a sensible match, return fewer.

Catalogue (index → title · keyword · 1-line excerpt):
${catalogue}

Return ONLY this JSON (no prose, no markdown fence):
{"picks":[{"index": <number>, "reason": "<one short sentence — 12 to 20 words — saying WHY this pick fits the visitor's question. Be specific. Reference the visitor's actual need. Never use the word \\"honest\\".">}]}

Rules:
- Picks must be ranked best-fit first.
- "reason" must reference something concrete from the excerpt or keyword, not generic praise.
- Never invent specs. Never reference products NOT in the catalogue.
- If nothing in the catalogue fits, return {"picks":[]}.`

  // 5. Haiku — fast + cheap, this is a per-visitor query.
  let picksOut: PickOut[] = []
  try {
    const client = createAnthropicClient()
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })
    recordAnthropicUsage(msg, { userId, feature: 'product_finder', model: 'claude-haiku-4-5-20251001' })
    const text = (msg.content[0] as { type: string; text: string })?.text || ''
    const m = text.match(/\{[\s\S]*\}/)
    if (m) {
      const parsed = JSON.parse(m[0]) as { picks?: Array<{ index?: number; reason?: string }> }
      picksOut = (parsed.picks || []).slice(0, 3).map(p => {
        const r = typeof p.index === 'number' && reviews[p.index] ? reviews[p.index] : null
        if (!r) return null
        return {
          title: r.title,
          url: r.url,
          image: r.image,
          score: null,
          reason: (p.reason || '').trim().slice(0, 220),
        }
      }).filter(Boolean) as PickOut[]
    }
  } catch {
    // Fall through with empty picks rather than 500-ing the widget.
  }

  return cors({ picks: picksOut, brand, _meta: { catalogue: reviews.length } }, 200)
}

function cors(json: unknown, status: number) {
  return NextResponse.json(json, { status, headers: CORS })
}
