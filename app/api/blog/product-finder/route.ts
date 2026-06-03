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

  // 3. Pull recent published reviews. We keep this tight — top 40 by score —
  //    so the prompt stays compact and Haiku stays fast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: reviewsRaw } = await (admin as any)
    .from('blog_posts')
    .select('id, title, excerpt, wordpress_url, featured_image_url, category, ai_overall_score, product_name')
    .eq('user_id', userId)
    .eq('post_type', 'review')
    .not('wordpress_url', 'is', null)
    .order('ai_overall_score', { ascending: false, nullsFirst: false })
    .limit(40)
  const reviews = (reviewsRaw ?? []) as Array<{
    id: string; title: string; excerpt: string | null; wordpress_url: string;
    featured_image_url: string | null; category: string | null;
    ai_overall_score: number | null; product_name: string | null;
  }>
  if (reviews.length === 0) return cors({ picks: [], brand, reason: 'no_reviews' }, 200)

  // 4. Compact catalogue for the prompt — only enough to identify each pick.
  const catalogue = reviews.map((r, i) => `[${i}] ${r.product_name || r.title} (${r.category || 'uncategorised'})${r.ai_overall_score ? ` · ${r.ai_overall_score}/5` : ''}\n    ${(r.excerpt || '').slice(0, 220)}`).join('\n\n')

  const prompt = `You are an AI product finder for a review blog. The visitor asked:
"${q}"

Pick the 3 reviews from this catalogue that BEST match the visitor's intent. If fewer than 3 are a sensible match, return fewer.

Catalogue (index → product · category · score · 1-line excerpt):
${catalogue}

Return ONLY this JSON (no prose, no markdown fence):
{"picks":[{"index": <number>, "reason": "<one short sentence — 12 to 20 words — saying WHY this pick fits the visitor's question. Be specific. Reference the visitor's actual need. Never use the word \\"honest\\".">}]}

Rules:
- Picks must be ranked best-fit first.
- "reason" must reference something concrete from the excerpt or category, not generic praise.
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
          title: r.product_name || r.title,
          url: r.wordpress_url,
          image: r.featured_image_url,
          score: r.ai_overall_score,
          reason: (p.reason || '').trim().slice(0, 220),
        }
      }).filter(Boolean) as PickOut[]
    }
  } catch {
    // Fall through with empty picks rather than 500-ing the widget.
  }

  return cors({ picks: picksOut, brand }, 200)
}

function cors(json: unknown, status: number) {
  return NextResponse.json(json, { status, headers: CORS })
}
