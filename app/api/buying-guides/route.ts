// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Buying Guides v1.1 — keyword/topic-centric (not category-centric).
//
// Real reviews on the platform almost never have a "category" set — they're
// authored from per-video transcripts and carry a `seo_keyword` instead (the
// long-tail buyer search phrase) plus an `affiliate_keywords` array. The
// useful signal for "what guides could this site write" is therefore
// clustering by SHARED seo_keyword tokens, not a single category column.
//
// Contract:
//   GET  /api/buying-guides
//     → { suggestions: [{topic, count}], guides: [{id,title,url,topic,created_at}] }
//     suggestions are computed by tokenizing each review's
//     `seo_keyword + title` into bigrams/trigrams and surfacing any phrase
//     that appears across ≥3 reviews.
//
//   POST /api/buying-guides body: { topic: string }
//     1. Pulls every published review's title+excerpt+seo_keyword+url+image
//     2. Haiku picks 5-7 best-fit reviews + a "Best for X" label for each
//     3. Sonnet writes the long-form "Best <topic> for <year>" round-up
//     4. Publish to WordPress (tagged buying-guide) + save as post_type='guide'
//     5. Returns { ok, postId, url, title }
//
// Images come from youtube_videos.thumbnail_url joined via video_id since
// blog_posts has no featured_image_url column.

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
  slug: string
  excerpt: string | null
  wordpress_url: string | null
  seo_keyword: string | null
  affiliate_keywords: string[] | null
  video_id: string
  youtube_videos: { thumbnail_url: string | null } | null
}

// ─── Topic clustering helpers ──────────────────────────────────────────────
const STOP = new Set([
  'the','a','an','and','or','for','of','to','in','on','at','vs','with','by','best',
  'review','reviews','that','this','my','our','your','from','is','are','was','were',
  'i','it','its','as','if','than','then','can','do','does','use','used','get','got',
  'has','have','had','one','two','more','most','some','any','no','not','only','just',
  'how','what','why','when','where','which','who','should','will','would','could',
  '2024','2025','2026','2027','really','very','too','really','also','worth','vs',
])
function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(t => t && !STOP.has(t) && t.length > 2)
}
function ngrams(toks: string[], n: number): string[] {
  const out: string[] = []
  for (let i = 0; i + n <= toks.length; i++) out.push(toks.slice(i, i + n).join(' '))
  return out
}

interface SuggestionItem { topic: string; count: number }
function suggestTopics(reviews: ReviewRow[]): SuggestionItem[] {
  // Dedup key is wordpress_url, NOT r.id — WP-REST-only rows have id=''
  // (no MVP blog_posts row yet), so keying by id collapses them all onto
  // a single bucket and the cluster counts come out as 1 instead of N.
  const counts = new Map<string, Set<string>>() // phrase → set of canonical URLs
  for (const r of reviews) {
    const key = r.wordpress_url || r.id
    if (!key) continue
    const text = `${r.seo_keyword || ''} ${r.title}`
    const t = tokens(text)
    const phrases = [...ngrams(t, 2), ...ngrams(t, 3)]
    for (const p of phrases) {
      if (!counts.has(p)) counts.set(p, new Set())
      counts.get(p)!.add(key)
    }
  }
  // Keep phrases that appear in ≥3 reviews. Prefer trigrams over bigrams when
  // the count matches (more specific topic). De-dup near-duplicates by string
  // containment so "best sleep mask" and "sleep mask" don't both show.
  const raw = Array.from(counts.entries())
    .filter(([, ids]) => ids.size >= 3)
    .map(([topic, ids]) => ({ topic, count: ids.size }))
    .sort((a, b) => (b.topic.split(' ').length - a.topic.split(' ').length) || (b.count - a.count))
  const kept: SuggestionItem[] = []
  for (const cand of raw) {
    const dupe = kept.some(k => k.topic.includes(cand.topic) || cand.topic.includes(k.topic))
    if (!dupe) kept.push(cand)
    if (kept.length >= 12) break
  }
  return kept.sort((a, b) => b.count - a.count)
}

// ─── Helper: pull every published review for a user ────────────────────────
//
// Primary source is the live WordPress REST API — that's the ground truth
// for "what's on this blog right now". Many users' reviews were authored
// outside MVP (legacy posts, manual WP edits, imported content) so reading
// only blog_posts misses most of the catalogue. We then enrich each WP
// row with MVP's seo_keyword + thumbnail when blog_posts has a matching
// row (matched by wordpress_url).
async function loadReviews(supabase: Awaited<ReturnType<typeof createServerClient>>, userId: string): Promise<ReviewRow[]> {
  const stripUrl = (u: string) => u.replace(/\/+$/, '').toLowerCase()
  const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim()
  const byUrl = new Map<string, ReviewRow>()

  // 1. Pull from MVP first to learn the WP base URL (integrations.wordpress_url).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await supabase
    .from('integrations')
    .select('wordpress_url')
    .eq('user_id', userId)
    .maybeSingle()
  const wpBase = (integ?.wordpress_url as string | null)?.replace(/\/+$/, '') || ''

  // 2. MVP blog_posts — preserves video_id (needed for the FK on insert) +
  //    seo_keyword + youtube thumbnail. This is the enrichment source.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: mvpRows } = await (supabase as any)
    .from('blog_posts')
    .select('id, title, slug, excerpt, wordpress_url, seo_keyword, affiliate_keywords, video_id, youtube_videos(thumbnail_url)')
    .eq('user_id', userId)
    .eq('post_type', 'review')
    .not('wordpress_url', 'is', null)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(200)
  for (const r of (mvpRows ?? []) as ReviewRow[]) {
    byUrl.set(stripUrl(r.wordpress_url!), r)
  }

  // 3. WP REST — the wider catalogue. For each WP post not already mapped
  //    to an MVP row, fabricate a ReviewRow using { title, excerpt, link }.
  //    video_id is left empty for these (used only by the POST insert path,
  //    which falls back to the top MVP-tracked pick to keep the FK valid).
  if (wpBase) {
    try {
      const res = await fetch(`${wpBase}/wp-json/wp/v2/posts?per_page=100&_embed=wp:featuredmedia&_fields=link,title,excerpt,_links,_embedded`, {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: 'application/json' },
      })
      if (res.ok) {
        const wpPosts = await res.json() as Array<{
          link: string
          title: { rendered: string }
          excerpt: { rendered: string }
          _embedded?: { 'wp:featuredmedia'?: Array<{ source_url?: string }> }
        }>
        for (const p of wpPosts) {
          if (!p.link) continue
          const key = stripUrl(p.link)
          const img = p._embedded?.['wp:featuredmedia']?.[0]?.source_url || null
          const existing = byUrl.get(key)
          if (existing) {
            // Patch image onto the MVP row if it didn't have one
            if (!existing.youtube_videos?.thumbnail_url && img) {
              existing.youtube_videos = { thumbnail_url: img }
            }
          } else {
            byUrl.set(key, {
              id: '',
              title: stripHtml(p.title?.rendered || ''),
              slug: '',
              excerpt: stripHtml(p.excerpt?.rendered || '').slice(0, 280),
              wordpress_url: p.link,
              seo_keyword: null,
              affiliate_keywords: null,
              video_id: '',
              youtube_videos: img ? { thumbnail_url: img } : null,
            })
          }
        }
      }
    } catch { /* non-fatal — fall through to MVP-only */ }
  }

  return Array.from(byUrl.values())
}

// ─── Helper: feature gate ──────────────────────────────────────────────────
//
// Buying Guides only earns its keep above a 500-post catalogue. We check
// the live WP X-WP-Total header (with Next's 5-min fetch cache) so the
// signal is the same one the sidebar uses to decide whether to surface
// the nav entry. Admin always passes.
async function isUnlocked(supabase: Awaited<ReturnType<typeof createServerClient>>, userId: string): Promise<{ unlocked: boolean; total: number; tier: string }> {
  const { data: integ } = await supabase
    .from('integrations')
    .select('wordpress_url, tier')
    .eq('user_id', userId)
    .maybeSingle()
  const tier = (integ?.tier as string | null) || 'trial'
  if (tier === 'admin') return { unlocked: true, total: Infinity, tier }
  const wpUrl = integ?.wordpress_url as string | null
  if (!wpUrl) return { unlocked: false, total: 0, tier }
  try {
    const res = await fetch(`${wpUrl.replace(/\/+$/, '')}/wp-json/wp/v2/posts?per_page=1&_fields=id`, {
      signal: AbortSignal.timeout(2500),
      headers: { Accept: 'application/json' },
      next: { revalidate: 300 },
    })
    if (!res.ok) return { unlocked: false, total: 0, tier }
    const total = parseInt(res.headers.get('x-wp-total') || '0', 10)
    return { unlocked: total >= 500, total, tier }
  } catch {
    return { unlocked: false, total: 0, tier }
  }
}
const UNLOCK_THRESHOLD = 500

// ─── GET ───────────────────────────────────────────────────────────────────
export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await isUnlocked(supabase, user.id)
  if (!gate.unlocked) {
    return NextResponse.json({
      locked: true,
      threshold: UNLOCK_THRESHOLD,
      currentPostCount: gate.total,
      suggestions: [],
      guides: [],
      reviewCount: 0,
    })
  }

  const reviews = await loadReviews(supabase, user.id)
  const suggestions = suggestTopics(reviews)

  // Previously generated guides
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: guideRows } = await (supabase as any)
    .from('blog_posts')
    .select('id, title, wordpress_url, seo_keyword, created_at')
    .eq('user_id', user.id)
    .eq('post_type', 'guide')
    .order('created_at', { ascending: false })
    .limit(30)

  return NextResponse.json({
    reviewCount: reviews.length,
    suggestions,
    guides: ((guideRows ?? []) as Array<{ id: string; title: string; wordpress_url: string | null; seo_keyword: string | null; created_at: string }>).map(g => ({
      id: g.id, title: g.title, url: g.wordpress_url, topic: g.seo_keyword, created_at: g.created_at,
    })),
  })
}

// ─── POST — generate + publish ─────────────────────────────────────────────
export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await isUnlocked(supabase, user.id)
  if (!gate.unlocked) {
    return NextResponse.json({
      error: `Buying Guides unlocks at ${UNLOCK_THRESHOLD} published posts. You currently have ${gate.total}.`,
      code: 'catalogue_too_small',
    }, { status: 403 })
  }

  // Pro/admin gate
  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (integ?.tier as string | undefined) ?? 'trial'
  if (tier !== 'pro' && tier !== 'admin') {
    return NextResponse.json({ error: 'Buying guides require the Pro tier.', code: 'tier_not_allowed' }, { status: 403 })
  }

  let body: { topic?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const topic = (body.topic || '').trim()
  if (!topic) return NextResponse.json({ error: 'topic required' }, { status: 400 })
  if (topic.length > 200) return NextResponse.json({ error: 'topic too long' }, { status: 400 })

  const reviews = await loadReviews(supabase, user.id)
  if (reviews.length < 3) {
    return NextResponse.json({ error: `Need at least 3 published reviews. Found ${reviews.length}.` }, { status: 400 })
  }

  // Resolve WP
  const site = await getWordPressCredentials(supabase, user.id)
  if (!site) return NextResponse.json({ error: 'No WordPress site connected.' }, { status: 400 })

  // Brand context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand } = await supabase
    .from('brand_profiles')
    .select('name, author_name')
    .eq('user_id', user.id)
    .maybeSingle()
  const brandName = (brand?.name as string) || 'our reviews'
  const reviewerName = (brand?.author_name as string) || 'we'

  const client = createAnthropicClient()

  // ── 1. Haiku: pick the best 5-7 reviews for the topic + a "Best for X" label
  const catalogue = reviews.map((r, i) => `[${i}] ${r.title}${r.seo_keyword ? ` (kw: ${r.seo_keyword})` : ''}\n    ${(r.excerpt || '').slice(0, 280)}`).join('\n\n')
  const pickerPrompt = `You are selecting picks for a "Best ${topic}" buying-guide round-up. From the catalogue below, choose the 5 to 7 reviews that BEST match the topic. If fewer than 3 are a sensible match, return what you have.

Topic: "${topic}"

Catalogue (index → title → 1-line excerpt):
${catalogue}

Return ONLY this JSON (no prose, no fence):
{"picks":[{"index": <number>, "label": "<2-3 word slot, e.g. 'Best Overall', 'Best on a Budget', 'Best for Side Sleepers', 'Best Splurge', 'Best for Travel'>"}]}

Rules:
- The FIRST pick must be labelled "Best Overall".
- Labels must be DISTINCT (no two picks share the same label).
- Labels must reference real differentiating use cases when possible.
- Picks ordered best-fit first.
- If nothing in the catalogue fits the topic, return {"picks":[]}.
- NEVER use the word "honest".`

  let picks: Array<{ review: ReviewRow; label: string }> = []
  try {
    const pickerMsg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: pickerPrompt }],
    })
    recordAnthropicUsage(pickerMsg, { userId: user.id, tier, feature: 'buying_guide_picker', model: 'claude-haiku-4-5-20251001' })
    const text = (pickerMsg.content[0] as { type: string; text: string })?.text || ''
    const m = text.match(/\{[\s\S]*\}/)
    if (m) {
      const parsed = JSON.parse(m[0]) as { picks?: Array<{ index?: number; label?: string }> }
      picks = (parsed.picks || [])
        .map(p => {
          const r = typeof p.index === 'number' ? reviews[p.index] : null
          if (!r) return null
          return { review: r, label: (p.label || 'Best Overall').slice(0, 60) }
        })
        .filter(Boolean) as Array<{ review: ReviewRow; label: string }>
    }
  } catch (err) {
    return NextResponse.json({ error: `Picker failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 500 })
  }

  if (picks.length < 3) {
    return NextResponse.json({ error: `Couldn't find 3 reviews matching "${topic}". Try a broader topic or add more reviews first.` }, { status: 400 })
  }
  picks = picks.slice(0, 7)

  // ── 2. Sonnet: write the guide HTML ──────────────────────────────────────
  const year = new Date().getUTCFullYear()
  const picksContext = picks.map((p, i) => `
${i + 1}. ${p.review.title}  —  Label: "${p.label}"
   URL: ${p.review.wordpress_url}
   Image: ${p.review.youtube_videos?.thumbnail_url || ''}
   SEO keyword: ${p.review.seo_keyword || 'n/a'}
   Excerpt: ${(p.review.excerpt || '').slice(0, 320)}
`).join('\n')

  const writerPrompt = `You are writing a "Best ${topic} for ${year}" buying guide for ${brandName}. The guide is built from the ${picks.length} picks below — every fact must come from those picks; never invent products, specs, or use cases. NEVER use the word "honest" or any variant.

═══════════════════════════════════════
PICKS (#1 is "Best Overall" — keep ordering as given)
═══════════════════════════════════════
${picksContext}

═══════════════════════════════════════
OUTPUT: one block of valid WordPress block-HTML (Gutenberg comments OK). No prose before or after the HTML.
═══════════════════════════════════════

1. INTRO (H2 "Quick recap" + 2-3 short first-person paragraphs)
   - Who this guide is for, one sentence
   - What ${reviewerName} actually tested to compile it
   - How many ended up worth recommending (${picks.length})

2. QUICK PICKS TABLE (HTML — one row per pick: name, label, "Read full review" link):
<table class="gr-picks" style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px;border:1px solid #e5e5e7;border-radius:6px;overflow:hidden">
  <thead><tr style="background:#fafafa">
    <th style="text-align:left;padding:10px 14px;font-weight:700;color:#86868b;text-transform:uppercase;font-size:11px;letter-spacing:.8px;border-bottom:1px solid #e5e5e7">Pick</th>
    <th style="text-align:left;padding:10px 14px;font-weight:700;color:#86868b;text-transform:uppercase;font-size:11px;letter-spacing:.8px;border-bottom:1px solid #e5e5e7">Best for</th>
    <th style="text-align:left;padding:10px 14px;font-weight:700;color:#86868b;text-transform:uppercase;font-size:11px;letter-spacing:.8px;border-bottom:1px solid #e5e5e7">Read</th>
  </tr></thead>
  <tbody>
    <tr><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;color:#1d1d1f;font-weight:600">{name}</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;color:#3a3a3c">{label}</td><td style="padding:10px 14px;border-bottom:1px solid #f0f0f0"><a href="{review url}" style="color:#0071e3;text-decoration:none;font-weight:600">Full review →</a></td></tr>
    {one row per pick}
  </tbody>
</table>

3. PER-PICK SECTIONS (one H2 per pick, in order):
   - H2: "{N}. {product name from title} — {label}" (e.g. "1. Step to Bed — Best Overall")
   - One <figure> at top with the linked review's image (from Image: field) wrapped in an <a> to the review URL; if no image, OMIT the figure
   - 3-4 short FIRST-PERSON paragraphs — why this pick wins its slot, the specific feature that seals it, one trade-off, one quick "pick this over the others when…" scenario
   - End the pick's section with this CTA (use the pick's URL):
     <p style="margin:18px 0 32px"><a href="{review URL}" style="display:inline-flex;align-items:center;gap:8px;background:#7C3AED;color:#fff;font-size:14px;font-weight:700;padding:12px 22px;border-radius:8px;text-decoration:none">Read the full review →</a></p>

4. FAQ (H2 "Frequently Asked Questions" + 4-6 H3 questions):
   - Each answer 2-3 sentences, ANSWER-FIRST
   - Cover: how to choose, compatibility/returns/warranty, who shouldn't buy a ${topic} at all
   - Each question must reference something specific to ${topic} (not generic)

5. WRAP-UP (H2 "Which one should you pick?"):
   - Two short paragraphs pointing to the #1 pick + one scenario where an
     alternative wins
   - End with a soft CTA inviting readers to read the full review of their top match

VOICE / STYLE RULES:
- First person throughout — match how ${reviewerName} writes
- Contractions everywhere (it's / you'll / I've / can't)
- Short blunt sentences mixed with longer ones
- Never use the word "honest" or any variant. Never use: moreover,
  furthermore, additionally, in addition, in conclusion, to summarize,
  in summary, overall, delve, tapestry, elevate, utilize, game-changer,
  revolutionary, cutting-edge, genuinely (any position), actually
  (anywhere), it's important to, it's essential to, em-dash in headings.
- No invented specs, prices, or features.`

  let html = ''
  try {
    const writerMsg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: writerPrompt }],
    })
    recordAnthropicUsage(writerMsg, { userId: user.id, tier, feature: 'buying_guide_writer', model: 'claude-sonnet-4-6' })
    html = (writerMsg.content[0] as { type: string; text: string })?.text || ''
  } catch (err) {
    return NextResponse.json({ error: `Writer failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 500 })
  }
  if (!html || html.length < 500) {
    return NextResponse.json({ error: 'Generation returned empty body' }, { status: 500 })
  }

  // ── 3. Publish ───────────────────────────────────────────────────────────
  const titleCase = topic.replace(/\b\w/g, c => c.toUpperCase())
  const wpTitle = `Best ${titleCase} for ${year}: ${picks.length} Picks We Actually Tested`
  const slug = `best-${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${year}`

  let wpPost: { id: number; link: string }
  try {
    const wpService = createWordPressService(site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined)
    let tagIds: number[] = []
    try { tagIds = await wpService.resolveTagIds(['buying-guide']) } catch { /* non-fatal */ }

    // ── Featured image (so the guide doesn't render with a blank card on
    // the homepage / Recently Updated strip). Use the FIRST pick that has
    // an image — these come from WP REST featuredmedia or the matched MVP
    // youtube thumbnail, so they're already brand-consistent with the
    // rest of the catalogue. Best-effort: a failed upload publishes the
    // guide without a hero rather than blocking the request.
    let featuredMedia: number | undefined
    try {
      const heroSrc = picks.find(p => p.review.youtube_videos?.thumbnail_url)?.review.youtube_videos?.thumbnail_url || null
      if (heroSrc) {
        const media = await wpService.uploadImageFromUrl(heroSrc, `${slug}-hero.jpg`)
        if (media?.id) featuredMedia = media.id
      }
    } catch { /* non-fatal */ }

    wpPost = await wpService.createPost({
      title: wpTitle,
      slug,
      content: html,
      excerpt: `${reviewerName} tested ${picks.length} ${topic} picks — here's the round-up: best overall, best on a budget, best for specific use cases.`,
      status: 'publish',
      tags: tagIds,
      ...(featuredMedia ? { featured_media: featuredMedia } : {}),
      comment_status: 'closed',
      ping_status: 'closed',
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'WordPress publish failed' }, { status: 500 })
  }

  // ── 4. Save row ──────────────────────────────────────────────────────────
  // Find the first picked review that has a real MVP video_id (rows pulled
  // from WP REST have empty video_id). blog_posts.video_id is NOT NULL in
  // the base schema (migration 024 made it nullable but only if applied)
  // so we need a non-empty value for safety. If NO picks have a video_id
  // we fall back to the most recent MVP review for this user.
  let fallbackVideoId: string | null = picks.find(p => p.review.video_id)?.review.video_id || null
  if (!fallbackVideoId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: anyReview } = await (supabase as any)
      .from('blog_posts')
      .select('video_id')
      .eq('user_id', user.id)
      .not('video_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    fallbackVideoId = (anyReview?.video_id as string | null) || null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: saved } = await (supabase as any)
    .from('blog_posts')
    .insert({
      user_id: user.id,
      video_id: fallbackVideoId,
      title: wpTitle,
      slug,
      content: html,
      excerpt: null,
      wordpress_post_id: wpPost.id,
      wordpress_url: wpPost.link,
      wordpress_site_id: site.site_id,
      status: 'published',
      post_type: 'guide',
      seo_keyword: topic,
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  return NextResponse.json({
    ok: true,
    postId: saved?.id ?? null,
    wpPostId: wpPost.id,
    url: wpPost.link,
    title: wpTitle,
    picksUsed: picks.map(p => ({ id: p.review.id, title: p.review.title, label: p.label })),
  })
}
