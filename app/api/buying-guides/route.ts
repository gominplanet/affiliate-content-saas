// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Buying Guides v1 (minimal) — auto-generate "Best X for [year]" round-ups
// from the user's existing reviews.
//
// What every major review site (PCMag /picks, TechRadar /best-X, Tom's Guide
// /best-picks/) ships and currently the highest-SEO-value content type for
// affiliate sites: "best wireless camera" gets 10× the search volume of any
// single product review, and the buyer intent is sky-high.
//
// v1 contract:
//   GET  /api/buying-guides           → { categories: [{category, count}],
//                                         guides: [{id, title, url, category, created_at}] }
//   POST /api/buying-guides           → body { category, count? }
//                                      → publishes one buying-guide WP post,
//                                        returns { ok, postId, url, title }
//
// Scope kept tight on purpose so the user can see it land + click through
// to a real published guide. Out of scope for v1: scheduling, multi-site
// picker (uses default site), image generation per pick (carries thumbnails
// from the linked reviews), tier-based usage caps (admin/Pro only path).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'

export const maxDuration = 300

interface ReviewRow {
  id: string
  title: string
  excerpt: string | null
  wordpress_url: string | null
  featured_image_url: string | null
  category: string | null
  ai_overall_score: number | null
  amazon_asin: string | null
  product_name: string | null
}

// ─── GET — list categories with ≥3 reviews + recent guides ─────────────────
export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Pull every published review. We do the category counting in JS rather
  // than a Postgres GROUP BY because the categories column may be a single
  // string OR a comma-list, and we want to be tolerant of both.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (supabase as any)
    .from('blog_posts')
    .select('id, title, category, post_type, wordpress_url, created_at')
    .eq('user_id', user.id)
    .not('wordpress_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500)

  const reviews = (rows ?? []).filter((r: { post_type?: string }) => (r.post_type ?? 'review') === 'review') as Array<{ category: string | null }>
  const counts = new Map<string, number>()
  for (const r of reviews) {
    const cat = (r.category || '').trim()
    if (!cat) continue
    counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }
  const categories = Array.from(counts.entries())
    .filter(([, n]) => n >= 3)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)

  const guides = (rows ?? []).filter((r: { post_type?: string }) => r.post_type === 'guide') as Array<{
    id: string; title: string; category: string | null; wordpress_url: string | null; created_at: string
  }>

  return NextResponse.json({
    categories,
    guides: guides.slice(0, 30).map(g => ({
      id: g.id, title: g.title, url: g.wordpress_url, category: g.category, created_at: g.created_at,
    })),
  })
}

// ─── POST — generate + publish one buying guide ────────────────────────────
export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Tier gate — Pro/admin only for v1. Future: open to Creator with a cap.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (integ?.tier as string | undefined) ?? 'trial'
  if (tier !== 'pro' && tier !== 'admin') {
    return NextResponse.json({ error: 'Buying guides require the Pro tier.', code: 'tier_not_allowed' }, { status: 403 })
  }

  let body: { category?: string; count?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const category = (body.category || '').trim()
  const count = Math.max(3, Math.min(10, body.count ?? 6))
  if (!category) return NextResponse.json({ error: 'category required' }, { status: 400 })

  // ── 1. Pull candidate reviews ────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: reviewsRaw } = await (supabase as any)
    .from('blog_posts')
    .select('id, title, excerpt, wordpress_url, featured_image_url, category, ai_overall_score, amazon_asin, product_name')
    .eq('user_id', user.id)
    .eq('category', category)
    .eq('post_type', 'review')
    .not('wordpress_url', 'is', null)
    .order('ai_overall_score', { ascending: false, nullsFirst: false })
    .limit(20)

  const candidates = (reviewsRaw ?? []) as ReviewRow[]
  if (candidates.length < 3) {
    return NextResponse.json({
      error: `Need at least 3 published reviews in "${category}" to make a guide. Found ${candidates.length}.`,
    }, { status: 400 })
  }
  const picks = candidates.slice(0, count)

  // ── 2. Resolve WordPress credentials ─────────────────────────────────────
  const site = await getWordPressCredentials(supabase, user.id)
  if (!site) return NextResponse.json({ error: 'No WordPress site connected.' }, { status: 400 })

  // ── 3. Brand context for voice ────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand } = await supabase
    .from('brand_profiles')
    .select('name, author_name, niches')
    .eq('user_id', user.id)
    .maybeSingle()
  const brandName = (brand?.name as string) || 'our reviews'
  const reviewerName = (brand?.author_name as string) || 'we'

  // ── 4. Build the buying-guide prompt ─────────────────────────────────────
  // Distinct from the review prompt — round-up format, ranked picks with
  // "Best for X" subtitles, comparison table, FAQ, and a tight intro that
  // frames who this guide is for.
  const year = new Date().getUTCFullYear()
  const picksContext = picks.map((p, i) => `
${i + 1}. ${p.product_name || p.title}
   - Title: ${p.title}
   - URL: ${p.wordpress_url}
   - Excerpt: ${(p.excerpt || '').slice(0, 280)}
   - Overall score: ${p.ai_overall_score ?? 'n/a'}
   - ASIN: ${p.amazon_asin || 'n/a'}
`).join('\n')

  const prompt = `You are writing a "Best ${category} for ${year}" buying guide for ${brandName}. The guide round-ups ${picks.length} products the reviewer has already reviewed on this blog. Every fact must come from the picks below — do NOT invent products, specs, or use cases. NEVER use the word "honest" or any variant.

═══════════════════════════════════════
PICKS (in order — the model should KEEP this order; you may slightly adjust labels per pick but #1 is "Best Overall")
═══════════════════════════════════════
${picksContext}

═══════════════════════════════════════
STRUCTURE — return ONE BLOCK of valid WordPress block-HTML (Gutenberg comments OK)
═══════════════════════════════════════

1. INTRO (1 H2 "Quick recap" + 2-3 short paragraphs in first person):
   - Who this guide is for (one sentence — match the category)
   - What ${reviewerName} tested to put it together
   - How many ${reviewerName} ended up recommending

2. QUICK PICKS TABLE (HTML block — every pick gets a row with: name, "Best for X" tagline, "Read full review" link):
<table class="gr-picks" style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px;border:1px solid #e5e5e7;border-radius:6px;overflow:hidden">
  <thead><tr style="background:#fafafa">
    <th style="text-align:left;padding:10px 14px;font-weight:700;color:#86868b;text-transform:uppercase;font-size:11px;letter-spacing:.8px;border-bottom:1px solid #e5e5e7">Pick</th>
    <th style="text-align:left;padding:10px 14px;font-weight:700;color:#86868b;text-transform:uppercase;font-size:11px;letter-spacing:.8px;border-bottom:1px solid #e5e5e7">Best for</th>
    <th style="text-align:left;padding:10px 14px;font-weight:700;color:#86868b;text-transform:uppercase;font-size:11px;letter-spacing:.8px;border-bottom:1px solid #e5e5e7">Read</th>
  </tr></thead>
  <tbody>
    <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;color:#1d1d1f;font-weight:600">{name}</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;color:#3a3a3c">{tagline}</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0"><a href="{review url}" style="color:#0071e3;text-decoration:none;font-weight:600">Full review →</a></td></tr>
    {repeat for each pick}
  </tbody>
</table>

3. PER-PICK SECTIONS (one H2 per pick, in order):
   - H2: "{N}. {product name} — Best for {use case}" (e.g. "1. Step to Bed — Best Overall")
   - One <figure> at top with the linked review's featured image (uses the picks' featured_image_url verbatim) wrapped in an <a> to the full review URL
   - 3-4 short paragraphs in first person — why this pick won its "Best for X" slot,
     what specific feature seals it, one trade-off, one quick scenario where
     someone should pick this over the others
   - Bottom of each pick section: a clean CTA button linking to {full review URL}
     using this exact HTML:
     <p style="margin:18px 0 32px"><a href="{review URL}" style="display:inline-flex;align-items:center;gap:8px;background:#7C3AED;color:#fff;font-size:14px;font-weight:700;padding:12px 22px;border-radius:8px;text-decoration:none">Read the full ${'$'}{product name} review →</a></p>

4. SHORT FAQ (4-6 questions, H2 "Frequently Asked Questions" + H3 per question):
   - Use uncovered-ground questions: how to choose, common compatibility concerns, returns/warranty, who shouldn't buy a ${category} at all
   - Each answer 2-3 sentences, ANSWER-FIRST (lead with the verdict, then nuance)

5. WRAP-UP (1 H2 "Which one should you pick?"):
   - Two short paragraphs that point readers back to the #1 pick + name one
     scenario where one of the alternatives is the better choice
   - End with a soft CTA encouraging readers to read the full review of their top match

VOICE / STYLE RULES (same as the main review writer):
- First person throughout ("I", "we" — match how ${reviewerName} writes)
- Never refer to yourself in the third person
- Contractions everywhere (it's / you'll / I've / can't)
- Short blunt sentences mixed with longer ones — no AI-rhythm
- No banned filler: NEVER use the word "honest" or any variant. NEVER use:
    moreover, furthermore, additionally, in addition, in conclusion,
    to summarize, in summary, overall, delve, tapestry, elevate,
    utilize, game-changer, revolutionary, cutting-edge, genuinely
    (any position), actually (anywhere — body OR headings), it's
    important to, it's essential to, make sure to, em-dash in headings.
- No invented specs, prices, or features — every claim must come from the
  pick's excerpt or be a category-level truth a buyer already knows.

OUTPUT: ONLY the WordPress block-HTML for the article body. No prose
before or after the HTML. No explanation. Start with the intro H2.`

  // ── 5. Call Claude ───────────────────────────────────────────────────────
  let html = ''
  try {
    const client = createAnthropicClient()
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5-20251001',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    })
    recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'buying_guide_generate', model: 'claude-sonnet-4-5-20251001' })
    html = (msg.content[0] as { type: string; text: string })?.text || ''
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Generation failed' }, { status: 500 })
  }
  if (!html || html.length < 500) {
    return NextResponse.json({ error: 'Generation returned empty body' }, { status: 500 })
  }

  // ── 6. Publish to WordPress ──────────────────────────────────────────────
  const title = `Best ${category} for ${year}: ${picks.length} Picks We Actually Tested`
  const slug = `best-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${year}`
  let wpPost: { id: number; link: string }
  try {
    const wpService = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)
    // Resolve "buying-guide" tag (creates it on first run) so the WP front-end
    // can list these separately at /tag/buying-guide if the user wants.
    let tagIds: number[] = []
    try { tagIds = await wpService.resolveTagIds(['buying-guide']) } catch { /* non-fatal */ }
    wpPost = await wpService.createPost({
      title,
      slug,
      content: html,
      excerpt: `${reviewerName} tested ${picks.length} ${category} products. Here's the round-up — best overall, best on a budget, best for specific use cases.`,
      status: 'publish',
      tags: tagIds,
      comment_status: 'closed',
      ping_status: 'closed',
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'WordPress publish failed' }, { status: 500 })
  }

  // ── 7. Save to blog_posts as post_type='guide' ───────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: saved } = await (supabase as any)
    .from('blog_posts')
    .insert({
      user_id: user.id,
      title,
      content: html,
      excerpt: null,
      wordpress_post_id: wpPost.id,
      wordpress_url: wpPost.link,
      wordpress_site_id: site.site_id,
      category,
      post_type: 'guide',
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  return NextResponse.json({
    ok: true,
    postId: saved?.id ?? null,
    wpPostId: wpPost.id,
    url: wpPost.link,
    title,
    picksUsed: picks.map(p => ({ id: p.id, title: p.title })),
  })
}
