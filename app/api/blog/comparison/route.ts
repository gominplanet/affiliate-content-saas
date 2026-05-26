/**
 * POST /api/blog/comparison
 *
 * Multi-product COMPARISON or BUYING GUIDE generator. The user pastes 1–10
 * YouTube URLs (each a product they reviewed); MVP resolves each product,
 * ranks them (comparison → names a winner; guide → "best for" use-cases),
 * writes ~500 words selling each, generates a per-product image (the real
 * product re-staged in a new setting, no people, no packaging text), inserts
 * affiliate links, and publishes one post to WordPress.
 *
 * All paid tiers. Counts as ONE post against the cap (it's one blog_posts row).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { YoutubeTranscript } from 'youtube-transcript'
import { createAnthropicClient } from '@/lib/anthropic'
import { createWordPressService } from '@/services/wordpress'
import { discoverProductForVideo } from '@/lib/product-detect'
import { firstProductUrl, resolveFinalUrl } from '@/lib/product-link'
import { createGeniuslinkService } from '@/services/geniuslink'
import { fetchAmazonProduct } from '@/services/amazon'
import { checkUsageLimit, normalizeTier } from '@/lib/tier'
import { scrubBanned, BANNED_RULE } from '@/lib/scrub'
import { learnProfileToPrompt } from '@/lib/learn'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'
import { NO_BRAND_IMAGE_CLAUSE } from '@/lib/image-guard'
import { fal } from '@fal-ai/client'

export const maxDuration = 300

/** Pull the 11-char video id out of any common YouTube URL form. */
function extractVideoId(url: string): string | null {
  if (!url) return null
  const u = url.trim()
  // Bare id
  if (/^[A-Za-z0-9_-]{11}$/.test(u)) return u
  const m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/)
  return m?.[1] ?? null
}

interface ResolvedProduct {
  videoId: string
  videoTitle: string
  productName: string
  description: string
  bullets: string[]
  transcript: string
  affiliateUrl: string | null
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70)

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { videoUrls, format, topic, heroImageDataUrl } = (await request.json()) as {
    videoUrls?: string[]
    format?: 'comparison' | 'guide'
    topic?: string
    /** Optional user-uploaded hero image (data URL). When present we use it as
     *  the featured image instead of generating one. */
    heroImageDataUrl?: string
  }
  const mode = format === 'guide' ? 'guide' : 'comparison'
  const ids = Array.from(new Set((videoUrls || []).map(extractVideoId).filter((x): x is string => !!x))).slice(0, 10)
  if (ids.length < 2) {
    return NextResponse.json({ error: 'Please add at least 2 valid YouTube URLs (up to 10).' }, { status: 400 })
  }

  // ── Integration + brand context ────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wp } = await (supabase as any)
    .from('integrations')
    .select('tier,wordpress_url,wordpress_username,wordpress_app_password,geniuslink_api_key,geniuslink_api_secret,amazon_associates_tag')
    .eq('user_id', user.id)
    .single()
  const tier = normalizeTier(wp?.tier)

  // Paid tiers only (Creator / Pro / Admin) — trial can't use multi-product.
  if (tier === 'trial') {
    return NextResponse.json({
      error: 'Comparisons & buying guides are available on the Creator and Pro plans.',
      limitReached: true, cap: 'posts', currentTier: tier,
    }, { status: 403 })
  }
  if (!wp?.wordpress_url || !wp?.wordpress_app_password) {
    return NextResponse.json({ error: 'Connect your WordPress site first (Site & Integrations).' }, { status: 400 })
  }

  // Posts cap — one comparison = one post.
  const usage = await checkUsageLimit(supabase, user.id)
  if (!usage.allowed) {
    return NextResponse.json({
      error: usage.reason, limitReached: true, cap: 'posts',
      currentTier: usage.tier, upgrade: usage.upgrade,
    }, { status: 429 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand } = await (supabase as any)
    .from('brand_profiles')
    .select('learn_profile,affiliate_disclaimer,name,niches,author_name')
    .eq('user_id', user.id)
    .single()
  const learnBlock = learnProfileToPrompt(brand?.learn_profile)
  const disclaimer = (brand?.affiliate_disclaimer as string) ||
    '📌 As an Amazon Associate I earn from qualifying purchases. This post contains affiliate links — I may earn a small commission at no extra cost to you.'

  const ctx = { userId: user.id, tier }
  const genius = (wp.geniuslink_api_key && wp.geniuslink_api_secret)
    ? createGeniuslinkService(wp.geniuslink_api_key, wp.geniuslink_api_secret)
    : null

  // ── Resolve every product in parallel ──────────────────────────────────────
  async function resolveOne(videoId: string): Promise<ResolvedProduct | null> {
    try {
      // Prefer the synced row (title + description + transcript); fall back to oEmbed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: vid } = await (supabase as any)
        .from('youtube_videos')
        .select('title,description,transcript')
        .eq('user_id', user!.id)
        .eq('youtube_video_id', videoId)
        .maybeSingle()
      let videoTitle = (vid?.title as string) || ''
      const description = (vid?.description as string) || ''
      let transcript = (vid?.transcript as string) || ''
      if (!videoTitle) {
        try {
          const o = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`)
          if (o.ok) videoTitle = (await o.json())?.title || ''
        } catch { /* ignore */ }
      }
      if (!transcript) {
        try {
          const t = await YoutubeTranscript.fetchTranscript(videoId)
          transcript = t.map(x => x.text).join(' ').slice(0, 4000)
        } catch { /* no transcript — rely on product data */ }
      }
      if (!videoTitle && !transcript) return null

      // Product resolution (same pipeline as single-video blog gen).
      const discovered = await discoverProductForVideo(videoTitle, description, ctx)
      let productName = videoTitle
      let pDescription = ''
      let bullets: string[] = []
      let affiliateUrl: string | null = null

      if (discovered.asin) {
        try {
          const p = await fetchAmazonProduct(discovered.asin)
          if (p.title) productName = p.title
          pDescription = p.description || ''
          bullets = p.bullets || []
        } catch { /* fall through */ }
        if (genius) {
          try { affiliateUrl = (await genius.createAsinLinkWithCode(discovered.asin, productName)).url } catch { /* ignore */ }
        }
        if (!affiliateUrl && wp.amazon_associates_tag) {
          affiliateUrl = `https://www.amazon.com/dp/${discovered.asin}?tag=${wp.amazon_associates_tag}`
        }
      }
      // Non-Amazon / no affiliate link yet → use the linked store page.
      if (!affiliateUrl) {
        let pageUrl = firstProductUrl(description, wp.wordpress_url ?? null)
        if (pageUrl && /(?:geni\.us|amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly)/i.test(pageUrl)) {
          pageUrl = await resolveFinalUrl(pageUrl)
        }
        if (pageUrl) affiliateUrl = pageUrl
      }

      return { videoId, videoTitle, productName, description: pDescription, bullets, transcript, affiliateUrl }
    } catch {
      return null
    }
  }

  const resolved = (await Promise.all(ids.map(resolveOne))).filter((p): p is ResolvedProduct => !!p)
  if (resolved.length < 2) {
    return NextResponse.json({ error: 'Could not resolve enough products from those videos. Make sure each links to a clear product.' }, { status: 422 })
  }

  // ── Claude: rank + write each product section (structured, voice-applied) ───
  const anthropic = createAnthropicClient()
  const productBlocks = resolved.map((p, i) => `PRODUCT ${i + 1}:
- Name: ${p.productName}
- Video title: ${p.videoTitle}
- Marketing description: ${(p.description || '').slice(0, 600)}
- Key features: ${(p.bullets || []).slice(0, 6).join(' · ') || 'n/a'}
- Transcript excerpt (the creator's REAL first-hand experience — only use facts actually stated here): ${(p.transcript || '').slice(0, 1500) || 'n/a'}`).join('\n\n')

  const formatRules = mode === 'comparison'
    ? `This is a head-to-head COMPARISON. RANK all ${resolved.length} products from best to worst and name a clear WINNER (#1 pick). Each product's heading should reflect its rank + a short superlative ("Best Overall", "Best Value", "Best for Beginners", "Runner-Up", etc.). Open the post by teasing that you tested them all and one stood out. Include a short verdict line per product.`
    : `This is a BUYING GUIDE. Assign each product a distinct "Best for ___" use-case (best for small spaces, best on a budget, best premium pick, etc.) — no single loser, help the reader self-select. Open with what matters when choosing in this category.`

  const sys = `You are the creator writing in FIRST PERSON ("I"/"we") — you are the person who reviewed these products on camera. Never refer to "the reviewer" or use a third-person name. Only state facts that appear in each product's transcript excerpt or marketing description — NEVER invent specs, numbers, test results, or experiences. ${BANNED_RULE}\n${learnBlock}`

  const userPrompt = `Write a ${mode === 'comparison' ? 'product comparison' : 'buying guide'} blog post covering these ${resolved.length} products.

${topic?.trim() ? `TOPIC (use this): ${topic.trim()}` : `Infer the shared product CATEGORY from the products and create a compelling, SEO-friendly title for the ${mode} (e.g. "Best Wine Travel Protectors in 2026").`}

${formatRules}

${productBlocks}

Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "title": "SEO title for the whole post (<= 65 chars, no banned words)",
  "meta_description": "150-160 char meta description, compelling, no banned words",
  "hero_prompt": "one vivid sentence describing an editorial HERO photo for this article's product category — a clean, aspirational, magazine-style scene (NO people required, NO text). e.g. 'A row of modern cordless vacuums on a sunlit living-room floor'",
  "intro_html": "1-2 short intro paragraphs as raw HTML <p>...</p> blocks (first person, hook the reader, set up the ${mode})",
  "winner_index": ${mode === 'comparison' ? '<0-based index of your #1 pick among the products above>' : 'null'},
  "products": [
    {
      "index": <0-based index matching the PRODUCT N above>,
      "heading": "Short heading with rank/use-case, e.g. '1. Acme Pro — Best Overall'",
      "body_html": "About 450-500 words as raw HTML <p>...</p> (and optional <ul><li>) blocks. First person. Sell this product's real features + benefits from its data. Concrete, specific, no fabricated claims.",
      "verdict": "one punchy sentence — the bottom line for this product"
    }
    // ... one object per product, ORDERED by your ranking (best first for comparison)
  ],
  "conclusion_html": "1 short closing paragraph as <p> blocks with a soft CTA",
  "feature_table": {
    "features": ["5-8 short feature/capability labels relevant to THIS product category that differentiate the products, e.g. 'Cordless', 'HEPA filter', 'Self-emptying', 'Pet-hair tool', 'App control', '2yr+ warranty'"],
    "rows": [ { "index": <0-based product index>, "values": ["yes" | "no" | "partial", ...] } ]
  },
  "faq": [ { "q": "question", "a": "2-4 sentence answer, answer-first" } ]  // 4-5 FAQs
}

For "feature_table": pick features that actually DIFFERENTIATE these products. For each product, mark "yes" ONLY if its data/transcript shows it has that feature, "no" if it clearly lacks it, "partial" if limited/uncertain. NEVER mark "yes" to fill the grid — be truthful. "values" MUST be in the SAME ORDER as "features", one entry per feature, and include one row per product.`

  let parsed: {
    title: string; meta_description: string; hero_prompt?: string; intro_html: string; winner_index: number | null
    products: Array<{ index: number; heading: string; body_html: string; verdict: string }>
    conclusion_html: string; faq: Array<{ q: string; a: string }>
    feature_table?: { features: string[]; rows: Array<{ index: number; values: string[] }> }
  }
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: sys,
      messages: [{ role: 'user', content: userPrompt }],
    })
    recordUsage({ ...usageFromAnthropic(msg), userId: user.id, tier, feature: mode === 'comparison' ? 'comparison_post' : 'guide_post', model: 'claude-sonnet-4-6' })
    const raw = (msg.content[0] as { type: string; text: string }).text
    const j = raw.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(j?.[0] ?? raw)
  } catch (err) {
    return NextResponse.json({ error: `Writing failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 502 })
  }

  // ── Assemble the WordPress (Gutenberg) HTML ─────────────────────────────────
  const wpService = createWordPressService(wp.wordpress_url, wp.wordpress_username, wp.wordpress_app_password)
  const para = (html: string) => `<!-- wp:paragraph -->${html}<!-- /wp:paragraph -->`
  const scrub = (s: string) => scrubBanned(s || '')
  // Responsive YouTube embed block — shows the video thumbnail + plays inline.
  const ytEmbed = (videoId: string) => {
    const url = `https://www.youtube.com/watch?v=${videoId}`
    return `<!-- wp:embed {"url":"${url}","type":"video","providerNameSlug":"youtube","responsive":true,"className":"wp-embed-aspect-16-9 wp-has-aspect-ratio"} -->\n<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube wp-embed-aspect-16-9 wp-has-aspect-ratio"><div class="wp-block-embed__wrapper">\n${url}\n</div></figure>\n<!-- /wp:embed -->\n`
  }

  let body = ''
  // Affiliate disclaimer banner
  body += `<!-- wp:group {"style":{"color":{"background":"#fffbe6"},"spacing":{"padding":{"top":"16px","bottom":"16px","left":"20px","right":"20px"}},"border":{"left":{"color":"#FFC200","width":"4px"}}},"layout":{"type":"constrained"}} -->\n<div class="wp-block-group has-background" style="border-left-color:#FFC200;border-left-width:4px;background-color:#fffbe6;padding:16px 20px"><!-- wp:paragraph {"style":{"typography":{"fontSize":"13px"}}} --><p style="font-size:13px">${scrub(disclaimer)}</p><!-- /wp:paragraph --></div>\n<!-- /wp:group -->\n`
  body += `${scrub(parsed.intro_html)}\n` // intro — already <p> blocks

  // Order products by Claude's ranking (it returns them ordered); guard indexes.
  for (const item of parsed.products) {
    const p = resolved[item.index]
    if (!p) continue
    body += `<!-- wp:heading --><h2>${scrub(item.heading)}</h2><!-- /wp:heading -->\n`
    // Embed the source review video — readers see the thumbnail + can watch it.
    body += ytEmbed(p.videoId)
    body += `${scrub(item.body_html)}\n`
    if (item.verdict) {
      body += `<!-- wp:paragraph {"style":{"typography":{"fontStyle":"italic"}}} --><p><em>👉 ${scrub(item.verdict)}</em></p><!-- /wp:paragraph -->\n`
    }
    if (p.affiliateUrl) {
      body += `<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button {"backgroundColor":"vivid-amber"} --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${p.affiliateUrl}" target="_blank" rel="nofollow sponsored noopener">Check price → ${scrub(p.productName).slice(0, 40)}</a></div><!-- /wp:button --></div><!-- /wp:buttons -->\n`
    }
  }

  // ── Feature comparison chart (checkmarks) ───────────────────────────────────
  const ft = parsed.feature_table
  if (ft && Array.isArray(ft.features) && ft.features.length && Array.isArray(ft.rows) && ft.rows.length) {
    const mark = (v: string) => v === 'yes' ? '✅' : v === 'partial' ? '➖' : '❌'
    // Rows in the ranked product order, products down the side, features across.
    const orderedRows = parsed.products
      .map(pr => ft.rows.find(r => r.index === pr.index))
      .filter((r): r is { index: number; values: string[] } => !!r)
    const headCells = `<th>Product</th>${ft.features.map(f => `<th>${scrub(f)}</th>`).join('')}`
    const bodyRows = orderedRows.map(r => {
      const name = scrub(resolved[r.index]?.productName || `Product ${r.index + 1}`)
      const cells = ft.features.map((_, ci) => `<td style="text-align:center">${mark(r.values?.[ci] || 'no')}</td>`).join('')
      return `<tr><td><strong>${name}</strong></td>${cells}</tr>`
    }).join('')
    body += `<!-- wp:heading --><h2>Feature comparison at a glance</h2><!-- /wp:heading -->\n`
    body += `<!-- wp:table {"className":"is-style-stripes"} --><figure class="wp-block-table is-style-stripes"><table><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table><figcaption class="wp-element-caption">✅ yes · ➖ limited · ❌ no</figcaption></figure><!-- /wp:table -->\n`
  }

  // Conclusion
  body += `<!-- wp:heading --><h2>The bottom line</h2><!-- /wp:heading -->\n${scrub(parsed.conclusion_html)}\n`

  // FAQ
  if (Array.isArray(parsed.faq) && parsed.faq.length) {
    body += `<!-- wp:heading --><h2>Frequently Asked Questions</h2><!-- /wp:heading -->\n`
    for (const f of parsed.faq) {
      body += `<!-- wp:heading {"level":3} --><h3>${scrub(f.q)}</h3><!-- /wp:heading -->\n${para(scrub(f.a))}\n`
    }
  }

  const title = scrub(parsed.title) || (mode === 'comparison' ? 'Product Comparison' : 'Buying Guide')
  const slug = slugify(title)

  // ── Hero / featured image ───────────────────────────────────────────────────
  // User-uploaded design wins; otherwise generate a category-themed AI hero
  // (text-free, no brands). Upload to WP and set as featured_media. Best-effort
  // — a failed hero must not block publishing.
  let featuredMedia: number | undefined
  try {
    let heroSrc: string | null = null
    if (heroImageDataUrl && /^data:image\//.test(heroImageDataUrl)) {
      heroSrc = heroImageDataUrl
    } else if (process.env.FAL_KEY) {
      fal.config({ credentials: process.env.FAL_KEY })
      const heroPrompt = `${parsed.hero_prompt || `An editorial hero photo representing ${title}`}. Bright, aspirational, magazine-style editorial photography, clean composition, premium lighting, high quality, photorealistic. ${NO_BRAND_IMAGE_CLAUSE} No text, no words, no letters, no logos anywhere.`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await fal.subscribe('fal-ai/flux-pro/v1.1' as any, {
        input: { prompt: heroPrompt, image_size: 'landscape_16_9', num_inference_steps: 28, guidance_scale: 3.5, num_images: 1, output_format: 'jpeg', safety_tolerance: '2' },
        pollInterval: 3000,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      heroSrc = ((r.data as any)?.images as Array<{ url: string }> | undefined)?.[0]?.url ?? null
      if (heroSrc) recordUsage({ userId: user.id, tier, feature: 'comparison_hero_image', model: 'fal-flux-pro-v1.1', images: 1 })
    }
    if (heroSrc) {
      const media = await wpService.uploadImageFromUrl(heroSrc, `${slug}-hero.jpg`)
      if (media?.id) featuredMedia = media.id
    }
  } catch { /* publish without a hero rather than fail */ }

  let wpPost
  try {
    wpPost = await wpService.createPost({
      title,
      content: body,
      excerpt: scrub(parsed.meta_description),
      slug,
      status: 'publish',
      ...(featuredMedia ? { featured_media: featuredMedia } : {}),
      meta: { mvp_meta_description: scrub(parsed.meta_description) },
    })
  } catch (err) {
    return NextResponse.json({ error: `WordPress publish failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 502 })
  }

  // ── Save blog_posts row (post_type distinguishes it; counts as 1 post) ──────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('blog_posts').insert({
    user_id: user.id,
    video_id: resolved[0].videoId,
    title,
    slug,
    content: body,
    excerpt: scrub(parsed.meta_description),
    status: 'published',
    post_type: mode,
    wordpress_post_id: wpPost.id,
    wordpress_url: wpPost.link,
    ai_model: 'claude-sonnet-4-6',
    generation_prompt_version: 'comparison-v1',
    published_at: new Date().toISOString(),
  })

  return NextResponse.json({
    ok: true,
    url: wpPost.link,
    title,
    productCount: resolved.length,
    mode,
  })
}
