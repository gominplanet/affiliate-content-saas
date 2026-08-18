// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Articles v1 (ADMIN-ONLY) — informational long-form article generator.
//
// Unlike Buying Guides (product round-ups sourced from the review catalogue),
// Articles writes pure INFORMATIONAL content: a topic + options in, a
// researched, opinionated full article out (history, facts, stats, a data
// table + inline SVG chart, FAQ). Think a healthy-food blogger who wants
// supporting diet/nutrition articles alongside their product reviews.
//
// Gated to the admin/owner while we test. Mirrors the buying-guides route
// scaffolding: auth → admin gate → spendGate → Sonnet WITH web_search →
// scrubAiHtml → (optional) WordPress publish + blog_posts row (post_type
// 'article').
//
// NOTE (v1 scope): no hero-image generation here. Image generation is a
// deliberate fast-follow, not part of v1.
//
// POST /api/articles/generate
//   body: { topic, angle?, sections[], tone?, length?, keywords?, notes?, publish? }
//   publish falsy → { ok, title, html }              (preview only, no WP write)
//   publish true  → { ok, title, html, url, postId } (published to WordPress)

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createAnthropicClient } from '@/lib/anthropic'
import { toUserMessage } from '@/lib/friendly-error'
import { recordAnthropicUsage, recordUsage } from '@/lib/ai-usage'
import { spendGate } from '@/lib/ai-spend'
import { checkGenerationLimit } from '@/lib/tier'
import { scrubAiHtml } from '@/lib/html-scrub'
import { fal } from '@fal-ai/client'
import { NO_BRAND_IMAGE_CLAUSE } from '@/lib/image-guard'

export const maxDuration = 300

// The full set of toggleable sections. The client sends the subset the user
// ticked; we honor ONLY those (plus their order below for a sensible flow).
const SECTION_LABELS: Record<string, string> = {
  intro: 'Introduction — set up the topic and why it matters',
  history: 'History / background — how this came to be, key milestones',
  key_facts: 'Key facts — the concrete, researched things a reader should know',
  stats: 'Stats & data — numbers, a clean HTML data table AND a simple inline SVG bar chart built from that data',
  tips: 'Practical tips — actionable advice the reader can use',
  myths: 'Myths vs facts — common misconceptions, corrected',
  faq: 'FAQ — 4-6 real questions with answer-first responses',
  conclusion: 'Conclusion — a short opinionated wrap-up / takeaway',
}
const SECTION_ORDER = ['intro', 'history', 'key_facts', 'stats', 'tips', 'myths', 'faq', 'conclusion']

const LENGTH_WORDS: Record<string, string> = {
  short: 'about 800 words',
  medium: 'about 1500 words',
  long: 'about 2500 words',
}

const TONE_GUIDE: Record<string, string> = {
  friendly: 'warm and friendly, like explaining to a curious friend',
  authoritative: 'authoritative and expert, confident and well-sourced',
  conversational: 'conversational and casual, first-person, easy to read',
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── ADMIN GATE ────────────────────────────────────────────────────────
  // Articles is in early testing — only the admin/owner may use it.
  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (integ?.tier as string | undefined) ?? 'trial'
  if (tier !== 'admin') {
    return NextResponse.json({ error: 'Articles is in early testing (admin only for now).' }, { status: 403 })
  }

  // Monthly AI-spend circuit breaker (Sonnet writer + web search).
  const spendBlocked = await spendGate(user.id, tier)
  if (spendBlocked) return spendBlocked

  // ── Parse body ──────────────────────────────────────────────────────────
  let body: {
    topic?: string
    angle?: string
    sections?: string[]
    tone?: string
    length?: string
    keywords?: string
    notes?: string
    publish?: boolean
    // When publishing straight from a preview, the client sends back the exact
    // HTML + title it showed, so we publish those bytes instead of re-running
    // the (costly, non-deterministic) writer and shipping something different.
    html?: string
    title?: string
    // The previewed hero image URL, sent back on publish so we upload the same
    // image the user saw rather than generating a new one.
    heroUrl?: string
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const topic = (body.topic || '').trim()
  if (!topic) return NextResponse.json({ error: 'topic required' }, { status: 400 })
  if (topic.length > 200) return NextResponse.json({ error: 'topic too long' }, { status: 400 })

  const angle = (body.angle || '').trim()
  const keywords = (body.keywords || '').trim()
  const notes = (body.notes || '').trim()
  const tone = (['friendly', 'authoritative', 'conversational'].includes(body.tone || '')
    ? body.tone : 'conversational') as string
  const length = (['short', 'medium', 'long'].includes(body.length || '')
    ? body.length : 'medium') as string
  const publish = body.publish === true

  // Only honor known section keys, in the canonical order.
  const requested = Array.isArray(body.sections) ? body.sections : []
  const sections = SECTION_ORDER.filter(k => requested.includes(k))
  if (sections.length === 0) {
    return NextResponse.json({ error: 'Pick at least one section to include.' }, { status: 400 })
  }

  // Count against the monthly generation allowance — an article is one content
  // piece, same as a review or buying guide. Charged on PUBLISH (the piece is
  // kept), not on preview (spendGate above already backstops preview spend).
  // Admin is exempt inside checkGenerationLimit, so this is a no-op while the
  // tool is admin-only, and correctly meters it once it opens to paid tiers.
  if (publish) {
    const gen = await checkGenerationLimit(supabase, user.id)
    if (!gen.allowed) {
      return NextResponse.json({ error: gen.reason, limitReached: true, cap: 'generations', currentTier: gen.tier, upgrade: gen.upgrade }, { status: 429 })
    }
  }

  // ── Build the writer prompt ──────────────────────────────────────────────
  const sectionList = sections.map(k => `- ${SECTION_LABELS[k]}`).join('\n')
  const wantsStats = sections.includes('stats')
  const wantsFaq = sections.includes('faq')

  const writerPrompt = `You are writing a researched, informational blog article about "${topic}". This is NOT a product review or a sales page. It is a genuine, opinionated, well-structured article a real blogger would publish to inform their readers.

Use the web_search tool to ground the article in real facts, current figures, and concrete examples. Weave in the sources you find (as inline text like "according to <source>") where a stat or claim came from a search result.

═══════════════════════════════════════
TOPIC: ${topic}
${angle ? `\nTHE WRITER'S ANGLE / OPINION (make the article reflect this point of view): ${angle}` : ''}
${keywords ? `\nKEYWORDS to work in naturally (for SEO, no stuffing): ${keywords}` : ''}
${notes ? `\nEXTRA NOTES from the writer: ${notes}` : ''}

TONE: ${TONE_GUIDE[tone]}
LENGTH: ${LENGTH_WORDS[length]}

═══════════════════════════════════════
INCLUDE ONLY THESE SECTIONS, in this order (do NOT add sections that aren't listed):
${sectionList}
${wantsStats ? `
FOR THE STATS SECTION, you MUST include BOTH:
  1. A clean HTML <table> of the real data you found, e.g.:
     <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
       <thead><tr style="background:#faf7ff"><th style="text-align:left;padding:8px 12px;border-bottom:2px solid #7C3AED">Label</th><th style="text-align:right;padding:8px 12px;border-bottom:2px solid #7C3AED">Value</th></tr></thead>
       <tbody><tr><td style="padding:8px 12px;border-bottom:1px solid #eee">…</td><td style="padding:8px 12px;text-align:right;border-bottom:1px solid #eee">…</td></tr></tbody>
     </table>
  2. A simple, hand-built inline SVG BAR CHART of the SAME data — no external libraries, no <script>. Build it by hand with <svg><rect>/<text> so it renders anywhere. Use viewBox for responsiveness (e.g. viewBox="0 0 600 320"), bars in #7C3AED, labels + values in readable text, and a title. Scale the bar heights/widths to the real values. Keep it clean and minimal.
` : ''}
${wantsFaq ? `
FOR THE FAQ SECTION: use an H2 "Frequently Asked Questions", then 4-6 questions as H3, each answered in 2-3 answer-first sentences specific to ${topic}.
` : ''}

═══════════════════════════════════════
OUTPUT FORMAT (follow EXACTLY):
Line 1: the headline, prefixed with the literal token  ###TITLE###  then a single space then the headline text (plain text, no HTML, punchy, specific to the topic).
Then a line with the literal token  ###ARTICLE###  on its own.
Then the article body as semantic HTML.

The HTML body rules:
- Semantic HTML only: <h2>, <h3>, <p>, <ul>/<li>, <table>, <svg>, <blockquote>. Use ONE <blockquote> for a strong pull-quote or opinion if it fits.
- Do NOT include an <h1> in the body (the headline is returned separately). Start the body with a <p> or the first <h2>.
- Do NOT output markdown. Do NOT wrap in <html>/<head>/<body>. Do NOT wrap in a code fence.
- Concrete facts and real numbers wherever the research surfaced them.

VOICE / STYLE RULES:
- ABSOLUTE BAN on em-dashes (—) and en-dashes (–) EVERYWHERE. Use a comma, a period, or parentheses instead.
- Never use the word "honest" or any variant. Avoid: moreover, furthermore, additionally, in conclusion, to summarize, overall, delve, tapestry, elevate, utilize, game-changer, cutting-edge, genuinely, actually, "it's important to", "it's essential to".
- Contractions are good. Vary sentence length and openings. No invented statistics — if a number isn't backed by a search result, don't fabricate it.`

  // ── Publish the exact previewed bytes, if the client sent them back ────────
  // (preview → "Publish this" is deterministic: no fresh writer run).
  const preHtml = publish && typeof body.html === 'string' && body.html.trim().length > 300
    ? scrubAiHtml(body.html) : null
  const preTitle = publish && typeof body.title === 'string' && body.title.trim()
    ? scrubAiHtml(body.title.trim()).slice(0, 200) : null

  const client = createAnthropicClient()

  // ── Generate ─────────────────────────────────────────────────────────────
  let title = preTitle || topic.replace(/\b\w/g, c => c.toUpperCase())
  let html = preHtml || ''
  if (!preHtml) try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 } as any],
      messages: [{ role: 'user', content: writerPrompt }],
    })
    recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'article_generate', model: 'claude-sonnet-4-6' })

    // Concatenate every text block (web_search interleaves tool blocks).
    let raw = ''
    for (const b of msg.content) {
      if (b.type === 'text') raw += b.text
    }
    raw = raw.trim()

    // Pull the headline off the ###TITLE### / ###ARTICLE### delimiters.
    const titleMatch = raw.match(/###TITLE###\s*(.+)/)
    if (titleMatch) title = titleMatch[1].split('\n')[0].trim().slice(0, 200) || title
    const artIdx = raw.indexOf('###ARTICLE###')
    const bodyRaw = artIdx >= 0 ? raw.slice(artIdx + '###ARTICLE###'.length) : raw
    html = scrubAiHtml(bodyRaw)
    // Belt-and-braces: if a stray title token survived, strip it.
    html = html.replace(/###TITLE###.*$/m, '').replace(/###ARTICLE###/g, '').trim()
    // Scrub em-dashes from the separated title too.
    title = scrubAiHtml(title)
  } catch (err) {
    console.error('[articles] writer', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Couldn’t write the article just now. Please try again in a moment.') }, { status: 500 })
  }

  if (!html || html.length < 300) {
    return NextResponse.json({ error: 'Generation returned an empty article body' }, { status: 500 })
  }

  // ── Hero image (editorial, text-free) ─────────────────────────────────────
  // Drawn from the same paid image pipeline the other post types use (Flux Pro
  // via fal) and recorded so it counts. On a republish from preview we reuse the
  // exact image URL the user saw instead of generating a new one.
  let heroUrl: string | null = preHtml
    ? (typeof body.heroUrl === 'string' && body.heroUrl.trim() ? body.heroUrl.trim() : null)
    : null
  if (!preHtml && process.env.FAL_KEY) {
    try {
      fal.config({ credentials: process.env.FAL_KEY })
      const heroPrompt = `An editorial hero photo representing ${topic}. Bright, aspirational, magazine-style editorial photography, clean composition, premium lighting, photorealistic. ${NO_BRAND_IMAGE_CLAUSE} No text, no words, no letters, no logos anywhere.`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await fal.subscribe('fal-ai/flux-pro/v1.1' as any, {
        input: { prompt: heroPrompt, image_size: 'landscape_16_9', num_inference_steps: 28, guidance_scale: 3.5, num_images: 1, output_format: 'jpeg', safety_tolerance: '2' },
        pollInterval: 3000,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      heroUrl = ((r.data as any)?.images as Array<{ url: string }> | undefined)?.[0]?.url ?? null
      if (heroUrl) recordUsage({ userId: user.id, tier, feature: 'article_hero_image', model: 'fal-flux-pro-v1.1', images: 1 })
    } catch { heroUrl = null /* article still publishes without a hero */ }
  }

  // ── Preview only — no WordPress write ─────────────────────────────────────
  if (!publish) {
    return NextResponse.json({ ok: true, title, html, heroUrl })
  }

  // ── Publish to WordPress ──────────────────────────────────────────────────
  const site = await getWordPressCredentials(supabase, user.id)
  if (!site) return NextResponse.json({ error: 'No WordPress site connected.' }, { status: 400 })

  const wpService = createWordPressService(
    site.wordpress_url,
    site.wordpress_username,
    site.wordpress_app_password,
    site.wordpress_api_token || undefined,
  )

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80)
    || `article-${Date.now()}`

  // Filed under an "Articles" category (nice touch — keeps informational
  // posts off the product-review feed) + tagged 'article'. Both best-effort.
  const [categoryId, tagIds] = await Promise.all([
    wpService.createCategory('Articles').catch(() => null),
    wpService.resolveTagIds(['article']).catch(() => [] as number[]),
  ])

  // Upload the hero as the featured image (best-effort — publish regardless).
  let featuredMedia: number | undefined
  if (heroUrl) {
    try {
      const media = await wpService.uploadImageFromUrl(heroUrl, `${slug}-hero.jpg`)
      if (media?.id) featuredMedia = media.id
    } catch { /* publish without a featured image */ }
  }

  let wpPost: { id: number; link: string }
  try {
    wpPost = await wpService.createPost({
      title,
      slug,
      content: html,
      status: 'publish',
      ...(categoryId ? { categories: [categoryId] } : {}),
      ...(tagIds.length ? { tags: tagIds } : {}),
      ...(featuredMedia ? { featured_media: featuredMedia } : {}),
      comment_status: 'closed',
      ping_status: 'closed',
    })
  } catch (err) {
    console.error('[articles] wp publish', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Couldn’t publish to WordPress just now. Please check your site connection and try again.') }, { status: 500 })
  }

  // ── Save the blog_posts row (post_type 'article') ─────────────────────────
  // video_id is nullable (informational articles aren't tied to a video, same
  // as weekly-digest deal posts) — never attach the article to an unrelated
  // video just to fill the column.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: saved } = await (supabase as any)
    .from('blog_posts')
    .insert({
      user_id: user.id,
      video_id: null,
      title,
      slug,
      content: html,
      excerpt: null,
      wordpress_post_id: wpPost.id,
      wordpress_url: wpPost.link,
      wordpress_site_id: site.site_id,
      status: 'published',
      post_type: 'article',
      seo_keyword: topic,
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  return NextResponse.json({
    ok: true,
    title,
    html,
    url: wpPost.link,
    postId: saved?.id ?? null,
  })
}
