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
import { checkArticlesUsage, normalizeTier, TIERS } from '@/lib/tier'
import { scrubAiHtml } from '@/lib/html-scrub'
import { scorePostSeo } from '@/lib/seo-score'
import { pickRelatedPosts, type LinkCandidate } from '@/lib/internal-links'
import { fal } from '@fal-ai/client'
import { NO_BRAND_IMAGE_CLAUSE } from '@/lib/image-guard'
import { composeWithGptImage, composeWithNanoBananaPro, rehostToFal, rehostFacePhotos, GPT_IMAGE_COMPOSE_COST_MODEL, NANO_BANANA_PRO_COST_MODEL } from '@/lib/thumbnail-generators'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * "Related reading" — MVP picks the user's 3 most topically-related published
 * posts and renders their thumbnails in one row below the article. Selection is
 * the same free token-overlap scorer reviews use (pickRelatedPosts). Thumbnails
 * come from youtube_videos.thumbnail_url (the stored image for a creator's
 * posts). Best-effort: returns the html unchanged when there aren't ≥2 related
 * posts with a thumbnail. KSES-safe (table + a/img/strong + safe inline CSS) so
 * it survives WordPress.
 */
async function appendRelatedThumbs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any, userId: string, currentUrl: string | null,
  current: { title: string; keyword: string; snippet: string },
  html: string,
): Promise<string> {
  try {
    const { data: rows } = await sb
      .from('blog_posts')
      .select('title,seo_keyword,wordpress_url,post_type,youtube_videos(thumbnail_url)')
      .eq('user_id', userId)
      .eq('status', 'published')
      .not('wordpress_url', 'is', null)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(60)
    if (!Array.isArray(rows)) return html

    const thumbByUrl = new Map<string, string>()
    const candidates: LinkCandidate[] = []
    for (const r of rows) {
      const url = (r.wordpress_url as string | null) || ''
      const thumb = (r.youtube_videos as { thumbnail_url?: string | null } | null)?.thumbnail_url || null
      // Only posts with a real thumbnail and not the article itself.
      if (!url || !thumb || url === currentUrl) continue
      thumbByUrl.set(url, thumb)
      candidates.push({ title: r.title as string, url, keyword: r.seo_keyword as string | null, postType: r.post_type as string | null })
    }
    if (candidates.length < 2) return html

    const picked = pickRelatedPosts(
      { title: current.title, keyword: current.keyword, contentSnippet: current.snippet },
      candidates, 3,
    )
    if (picked.length < 2) return html

    const cells = picked.map(p => {
      const thumb = thumbByUrl.get(p.url) || ''
      return `<td style="width:33%;padding:6px;vertical-align:top;text-align:center"><a href="${esc(p.url)}" style="color:#1d1d1f;text-decoration:none"><img src="${esc(thumb)}" alt="${esc(p.title)}" style="width:100%;border-radius:10px;margin-bottom:8px" /><strong style="font-size:13px;line-height:1.35">${esc(p.title)}</strong></a></td>`
    }).join('')

    const block = `\n<h2>Related reading</h2>\n<table style="width:100%;border-collapse:collapse;margin:16px 0"><tbody><tr>${cells}</tr></tbody></table>\n`
    return html + block
  } catch {
    return html
  }
}

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

  // ── TIER GATE ─────────────────────────────────────────────────────────
  // Articles is a Creator/Studio/Pro feature (its own monthly cap). Trial +
  // Amazon (articlesPerMonth 0) can't use it; admin (null) is unlimited.
  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  if (TIERS[tier].articlesPerMonth === 0) {
    return NextResponse.json({ error: 'Articles is a Creator, Studio and Pro feature.', code: 'tier_not_allowed', currentTier: tier }, { status: 403 })
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
    // Hero image style: 'generic' (default), 'face' (creator's Face Model), or
    // 'product' (built around productImageUrl).
    heroStyle?: string
    productImageUrl?: string
    // When publishing straight from a preview, the client sends back the exact
    // HTML + title it showed, so we publish those bytes instead of re-running
    // the (costly, non-deterministic) writer and shipping something different.
    html?: string
    title?: string
    // The previewed hero image URL, sent back on publish so we upload the same
    // image the user saw rather than generating a new one.
    heroUrl?: string
    // The previewed meta description, carried back so the published excerpt
    // matches what was reviewed.
    meta?: string
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

  // Enforce the DEDICATED articles cap (Creator 5 / Studio 10 / Pro 15) — its
  // own allowance, NOT the shared postsPerMonth pool. Charged on PUBLISH (the
  // article is kept), not on preview (spendGate above backstops preview spend).
  // Admin (cap null) is exempt.
  if (publish) {
    const art = await checkArticlesUsage(supabase, user.id)
    if (!art.allowed) {
      return NextResponse.json({ error: art.reason, limitReached: true, cap: 'articles', currentTier: art.tier, upgrade: art.upgrade }, { status: 429 })
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
  2. A hand-built HTML/CSS BAR CHART of the SAME numeric data. CRITICAL: build it ONLY from <div> and <p> with inline styles — DO NOT use <svg>, <canvas>, <script>, or <style> tags (WordPress strips those, so the chart would vanish). Use ONLY these CSS properties (WordPress allows them): background, background-color, width, height, margin, padding, border-radius, color, font-weight, font-size, text-align. Each bar's width MUST be the value scaled to the largest value in the set, as a percentage (widthPct = round(value / maxValue * 100)). Use EXACTLY this structure, one label+track pair per data point:
     <div style="margin:24px 0;padding:16px;background:#faf7ff;border-radius:12px">
       <p style="font-weight:700;color:#4c1d95;margin:0 0 16px;font-size:15px">CHART TITLE</p>
       <p style="margin:0 0 5px;font-size:13px;color:#333">Label here — <strong>value</strong></p>
       <div style="background:#e9e0ff;border-radius:7px;height:22px;margin:0 0 16px"><div style="background:#7C3AED;height:22px;width:WIDTHPCT%;border-radius:7px"></div></div>
       <!-- repeat the label <p> + track <div> for every data point -->
     </div>
   Only compare like-for-like numbers in one chart (e.g. all percentages together, or all dollar values together). If the numbers aren't comparable, make two separate bar blocks.
` : ''}
${wantsFaq ? `
FOR THE FAQ SECTION: use an H2 "Frequently Asked Questions", then 4-6 questions as H3, each answered in 2-3 answer-first sentences specific to ${topic}.
` : ''}

═══════════════════════════════════════
SEO + AI-DISCOVERABILITY (REQUIRED — the article must score 80+ on-page and be quotable by AI Overviews / ChatGPT / Perplexity):
- ANSWER-FIRST INTRO: open with a direct, self-contained 2-3 sentence answer to "${topic}" BEFORE the first <h2> — the kind of summary an AI engine can quote verbatim. No preamble or throat-clearing.
- PRIMARY KEYWORD = "${topic}". Place it (or a very close variant) in ALL THREE of: the headline, the FIRST sentence of the intro, and at least ONE <h2> subheading. Natural, never stuffed.
- Use clear, specific <h2> headings, phrased as a question where it fits ("How does X actually work?") — question headings get pulled into AI answers.
- DEPTH: at least 700 words of real substance.
- Short, answer-first paragraphs and scannable lists — these are what AI engines cite.
- Any <img> you add MUST have descriptive alt text.

OUTPUT FORMAT (follow EXACTLY — THREE tokens, each at the start of its own line):
Line 1: ###TITLE### then a space then the headline (plain text, 40-65 characters, specific, includes the primary keyword).
Line 2: ###META### then a space then a meta description (ONE sentence, 140-160 characters, includes the primary keyword, compelling in a search result).
Then a line with ###ARTICLE### on its own.
Then the article body as semantic HTML.

The HTML body rules:
- Semantic HTML only: <h2>, <h3>, <p>, <ul>/<li>, <table>, <div>, <blockquote>. Use ONE <blockquote> for a strong pull-quote or opinion if it fits. NEVER use <svg>, <canvas>, <script> or <style> — WordPress strips them (charts must be the <div>/CSS bars described above).
- Do NOT include an <h1> in the body (the headline is returned separately). Start the body with the answer-first intro <p>.
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
  const sources: { url: string; title: string }[] = []
  let title = preTitle || topic.replace(/\b\w/g, c => c.toUpperCase())
  // Meta description (search snippet). Carried back from the preview on publish.
  let metaDesc = (publish && typeof body.meta === 'string') ? scrubAiHtml(body.meta.trim()).slice(0, 200) : ''
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

    // Concatenate text blocks (web_search interleaves tool blocks) and collect
    // the sources actually cited (text-block citations) plus any search results,
    // deduped by URL, so we can list them at the end of the article.
    let raw = ''
    const seenSrc = new Set<string>()
    const pushSrc = (url?: string, t?: string) => {
      if (!url || seenSrc.has(url) || !/^https?:\/\//i.test(url)) return
      seenSrc.add(url); sources.push({ url, title: (t || url).slice(0, 140) })
    }
    for (const b of msg.content) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const any = b as any
      if (b.type === 'text') {
        raw += b.text
        if (Array.isArray(any.citations)) for (const c of any.citations) pushSrc(c?.url, c?.title)
      } else if (any.type === 'web_search_tool_result' && Array.isArray(any.content)) {
        for (const r of any.content) pushSrc(r?.url, r?.title)
      }
    }
    raw = raw.trim()

    // Pull the headline + meta off the delimiter tokens.
    const titleMatch = raw.match(/###TITLE###\s*(.+)/)
    if (titleMatch) title = titleMatch[1].split('\n')[0].trim().slice(0, 200) || title
    const metaMatch = raw.match(/###META###\s*(.+)/)
    if (metaMatch) metaDesc = metaMatch[1].split('\n')[0].trim().slice(0, 200)
    const artIdx = raw.indexOf('###ARTICLE###')
    const bodyRaw = artIdx >= 0 ? raw.slice(artIdx + '###ARTICLE###'.length) : raw
    html = scrubAiHtml(bodyRaw)
    // Belt-and-braces: strip any stray delimiter tokens that survived.
    html = html.replace(/###TITLE###.*$/m, '').replace(/###META###.*$/m, '').replace(/###ARTICLE###/g, '').trim()
    title = scrubAiHtml(title)
    metaDesc = scrubAiHtml(metaDesc)
  } catch (err) {
    console.error('[articles] writer', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Couldn’t write the article just now. Please try again in a moment.') }, { status: 500 })
  }

  if (!html || html.length < 300) {
    return NextResponse.json({ error: 'Generation returned an empty article body' }, { status: 500 })
  }

  if (!preHtml) {
    // Sources — cite the research. When the article leans on external data, list
    // the pages the web search surfaced as linked references at the end (trust +
    // AEO signal). Capped, deduped, KSES-safe. (A preview-republish keeps the
    // exact bytes it already showed, sources included.)
    if (sources.length) {
      const items = sources.slice(0, 8)
        .map(s => `<li><a href="${esc(s.url)}" rel="nofollow noopener" target="_blank">${esc(s.title)}</a></li>`)
        .join('')
      html += `\n<h2>Sources</h2>\n<ul>${items}</ul>\n`
    }

    // Related reading — MVP's 3 most-related existing posts as a thumbnail row
    // below the conclusion. Best-effort; never blocks publish.
    html = await appendRelatedThumbs(
      supabase, user.id, null,
      { title, keyword: `${topic} ${keywords}`.trim(), snippet: html.replace(/<[^>]+>/g, ' ').slice(0, 800) },
      html,
    )
  }

  // On-page SEO / AEO score (same scorer the reviews use) — surfaced in the
  // preview so the creator sees it clears 80 before publishing. siteHost is taken
  // from the LAST absolute link (the Related-reading row = the user's own blog),
  // so those internal links are correctly counted.
  let seoScore: number | null = null
  try {
    const hosts = [...html.matchAll(/href="https?:\/\/([^/"]+)/g)].map(m => m[1])
    const siteHost = hosts.length ? hosts[hosts.length - 1] : null
    seoScore = scorePostSeo({ title, metaDescription: metaDesc || null, contentHtml: html, seoKeyword: topic, postType: 'article', siteHost }).score
  } catch { /* non-fatal */ }

  // ── Hero image ────────────────────────────────────────────────────────────
  // Three styles (toggle): 'generic' (editorial Flux photo of the topic),
  // 'face' (the creator composed into an editorial scene, from their Face Model),
  // or 'product' (an editorial hero built around a product image the user gives).
  // Face/product compose with gpt-image (+ nano-banana fallbacks); all record the
  // single 'article_hero_image' feature with the real model so cost is accurate.
  // On a republish from preview we reuse the exact image URL the user saw.
  const heroStyle: 'generic' | 'face' | 'product' =
    body.heroStyle === 'face' || body.heroStyle === 'product' ? body.heroStyle : 'generic'
  let heroUrl: string | null = preHtml
    ? (typeof body.heroUrl === 'string' && body.heroUrl.trim() ? body.heroUrl.trim() : null)
    : null
  let heroModel: string | null = null
  if (!preHtml) {
    try {
      // With my face → compose the creator into an editorial scene.
      if (heroStyle === 'face') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: fm } = await (supabase as any)
          .from('face_models').select('source_images')
          .eq('user_id', user.id).eq('status', 'ready')
          .not('source_images', 'is', null)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        const srcs: string[] = Array.isArray(fm?.source_images) ? fm.source_images : []
        const refs = srcs.length ? await rehostFacePhotos(supabase, srcs, 5) : []
        if (refs.length) {
          const prompt = `A bright, aspirational EDITORIAL MAGAZINE hero photo (16:9) for an article about ${topic}. Feature the SAME real person shown in the reference photos — reproduce their EXACT face and identity (bone structure, features, skin tone, hair, apparent age), photorealistic and naturally flattering, never generic or altered. Dress them in a fresh, natural casual outfit that suits the scene (do NOT copy clothing from the reference photos). Place them naturally in a real setting that fits the topic, relaxed and engaged, premium editorial lighting. ${NO_BRAND_IMAGE_CLAUSE} Render ABSOLUTELY NO text, letters, words, numbers or logos anywhere.`
          let composed = await composeWithGptImage({ prompt, referenceImageUrls: refs, aspectRatio: '16:9', numImages: 1 })
          heroModel = GPT_IMAGE_COMPOSE_COST_MODEL
          if (!composed[0]) { composed = await composeWithNanoBananaPro({ prompt, referenceImageUrls: refs, aspectRatio: '16:9', numImages: 1 }); heroModel = NANO_BANANA_PRO_COST_MODEL }
          heroUrl = composed[0] || null
        }
        // No usable face model → fall through to the generic Flux hero below.
      }

      // Product → editorial hero built around the product image the user gave.
      if (!heroUrl && heroStyle === 'product') {
        const purl = (typeof body.productImageUrl === 'string' ? body.productImageUrl.trim() : '')
        const ref = purl ? await rehostToFal(purl) : null
        if (ref) {
          const prompt = `A bright, aspirational EDITORIAL MAGAZINE hero photo (16:9) for an article about ${topic}. Feature the ACTUAL product from the reference image as a clean hero object — true shape, colour and materials, never its retail box or packaging, and with no printed text, badges or callouts on it. Style it in a premium editorial scene that fits the topic. ${NO_BRAND_IMAGE_CLAUSE} Render NO text, letters, words, numbers or logos anywhere.`
          const composed = await composeWithGptImage({ prompt, referenceImageUrls: [ref], aspectRatio: '16:9', numImages: 1 })
          heroUrl = composed[0] || null
          if (heroUrl) heroModel = GPT_IMAGE_COMPOSE_COST_MODEL
        }
      }

      // Generic (default, or a face/product fallback) → editorial Flux photo.
      if (!heroUrl && process.env.FAL_KEY) {
        fal.config({ credentials: process.env.FAL_KEY })
        const heroPrompt = `An editorial hero photo representing ${topic}. Bright, aspirational, magazine-style editorial photography, clean composition, premium lighting, photorealistic. ${NO_BRAND_IMAGE_CLAUSE} No text, no words, no letters, no logos anywhere.`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = await fal.subscribe('fal-ai/flux-pro/v1.1' as any, {
          input: { prompt: heroPrompt, image_size: 'landscape_16_9', num_inference_steps: 28, guidance_scale: 3.5, num_images: 1, output_format: 'jpeg', safety_tolerance: '2' },
          pollInterval: 3000,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        heroUrl = ((r.data as any)?.images as Array<{ url: string }> | undefined)?.[0]?.url ?? null
        if (heroUrl) heroModel = 'fal-flux-pro-v1.1'
      }

      if (heroUrl && heroModel) recordUsage({ userId: user.id, tier, feature: 'article_hero_image', model: heroModel, images: 1 })
    } catch { /* article still publishes without a hero */ }
  }

  // ── Preview only — no WordPress write ─────────────────────────────────────
  if (!publish) {
    return NextResponse.json({ ok: true, title, html, heroUrl, meta: metaDesc, seoScore })
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
      ...(metaDesc ? { excerpt: metaDesc } : {}),
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
      excerpt: metaDesc || null,
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
