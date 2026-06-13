/**
 * POST /api/blog/from-link — generate a full review blog post from a product
 * link / ASIN (no video required). The "non-YouTube" entry into the content
 * engine: paste an Amazon ASIN/URL or any store/affiliate link, optionally a
 * product name + angle, and MVP researches the product (the link + name + web/
 * owner sentiment), writes an SEO/AI-optimized review in the creator's voice
 * with MVP's rules + citation guards (no transcript to ground on, so research
 * IS the grounding), recloaks the link via Geniuslink when configured,
 * generates a hero/featured image, publishes to WordPress, and saves a normal
 * blog_posts row (post_type 'review', no video) so it lives in Posts and is
 * schedulable / social-pushable like any other post.
 *
 * Mirrors the proven app/api/blog/comparison flow (resolve → research → write →
 * recloak → hero → publish → guard → insert), single-product variant.
 *
 * Body: { link?, productName?, angle?, category?, includeImages?, siteId? }
 * Available on all paid tiers; counts as ONE post (postsPerMonth) + spend gate.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { createClaudeService } from '@/services/claude'
import { createWordPressService } from '@/services/wordpress'
import { resolveFinalUrl } from '@/lib/product-link'
import { createGeniuslinkService } from '@/services/geniuslink'
import { fetchAmazonProduct, extractAsin } from '@/services/amazon'
import { researchProductFromUrl } from '@/services/research'
import { checkUsageLimit, normalizeTier } from '@/lib/tier'
import { scrubBanned, BANNED_RULE } from '@/lib/scrub'
import { learnProfileToPrompt } from '@/lib/learn'
import { recordUsage, usageFromAnthropic } from '@/lib/ai-usage'
import { pingIndexNowForUrl } from '@/lib/seo-on-publish'
import { NO_BRAND_IMAGE_CLAUSE } from '@/lib/image-guard'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { spendGate } from '@/lib/ai-spend'
import { fal } from '@fal-ai/client'

export const runtime = 'nodejs'
export const maxDuration = 300

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)

// Shorteners/cloakers we resolve to a final URL before extracting an ASIN.
const CLOAK_RE = /(?:geni\.us|amzn\.to|a\.co|bit\.ly|tinyurl\.com|rebrand\.ly|fkbms\.|lddy\.no|shrsl\.|sovrn\.|go\.magik)/i

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth) return auth.error
  const { user, ownerId } = auth

  let body: { link?: string; productName?: string; angle?: string; category?: string; includeImages?: boolean; siteId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const link = (body.link || '').trim()
  const providedName = (body.productName || '').trim()
  const angle = (body.angle || '').trim()
  const category = (body.category || '').trim()
  const siteId = body.siteId
  if (!link && !providedName) {
    return NextResponse.json({ error: 'Paste a product link or ASIN — or at least the product name.' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wp } = await supabase
    .from('integrations')
    .select('tier,geniuslink_api_key,geniuslink_api_secret,amazon_associates_tag')
    .eq('user_id', ownerId)
    .maybeSingle()
  const tier = normalizeTier(wp?.tier)

  // Spend circuit breaker (Sonnet writer + hero image).
  const spendBlocked = await spendGate(ownerId, tier)
  if (spendBlocked) return spendBlocked

  const site = await getWordPressCredentials(supabase, ownerId, siteId)
  if (!site) return NextResponse.json({ error: 'Connect your WordPress site first (Set Up → WordPress).' }, { status: 400 })

  // One review = one post against the cap.
  const usage = await checkUsageLimit(supabase, user.id)
  if (!usage.allowed) {
    return NextResponse.json({ error: usage.reason, limitReached: true, cap: 'posts', currentTier: usage.tier, upgrade: usage.upgrade }, { status: 429 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand } = await supabase
    .from('brand_profiles')
    .select('learn_profile,affiliate_disclaimer,name,niches,author_name')
    .eq('user_id', ownerId)
    .maybeSingle()
  const learnBlock = learnProfileToPrompt(brand?.learn_profile)
  const disclaimer = (brand?.affiliate_disclaimer as string) ||
    '📌 As an Amazon Associate I earn from qualifying purchases. This post contains affiliate links — I may earn a small commission at no extra cost to you.'

  const ctx = { userId: user.id, tier }
  const genius = (wp?.geniuslink_api_key && wp?.geniuslink_api_secret)
    ? createGeniuslinkService(wp.geniuslink_api_key, wp.geniuslink_api_secret)
    : null

  // ── 1. Resolve the source: ASIN (Amazon) or any store/affiliate link ────────
  let finalUrl = link
  if (link && CLOAK_RE.test(link)) {
    try { finalUrl = await resolveFinalUrl(link) } catch { finalUrl = link }
  }
  const asin = link ? (extractAsin(finalUrl) || extractAsin(link)) : null

  let productName = providedName
  let pDescription = ''
  let bullets: string[] = []
  let affiliateUrl: string | null = null

  if (asin) {
    try {
      const p = await fetchAmazonProduct(asin)
      if (p.title) productName = providedName || p.title
      pDescription = p.description || ''
      bullets = p.bullets || []
    } catch { /* fall back to research / provided name */ }
    // Recloak via Geniuslink when configured, else append the Amazon tag.
    if (genius) {
      try { affiliateUrl = (await genius.createAsinLinkWithCode(asin, productName || 'product')).url } catch { /* ignore */ }
    }
    if (!affiliateUrl) {
      affiliateUrl = wp?.amazon_associates_tag
        ? `https://www.amazon.com/dp/${asin}?tag=${wp.amazon_associates_tag}`
        : `https://www.amazon.com/dp/${asin}`
    }
  } else if (link) {
    // Non-Amazon store/affiliate link — keep the user's own link (it already
    // carries their tracking). Geniuslink ASIN recloaking only applies to Amazon.
    affiliateUrl = link
  }
  if (!productName) productName = providedName || 'this product'

  // ── 2. Research grounding (web + owner sentiment) — replaces the transcript ──
  let research = ''
  try {
    const target = finalUrl || link || providedName
    if (target) {
      const r = await researchProductFromUrl(target, productName, ctx)
      if (typeof r === 'string') research = r
    }
  } catch { /* research is best-effort */ }

  if (!pDescription && !research && bullets.length === 0 && !providedName) {
    return NextResponse.json({ error: 'Couldn’t find enough about that product. Add the product name or a clearer link and try again.' }, { status: 422 })
  }

  // ── 3. Write the review (single product, grounded, MVP rules + voice) ───────
  const anthropic = createAnthropicClient()
  const sys = `You are the creator writing a FIRST-PERSON ("I"/"we") affiliate review of ONE product — you personally recommend it. Never write in third person or refer to "the reviewer". Only state facts present in the PRODUCT DATA or RESEARCH below — NEVER invent specs, numbers, prices, test results, or personal anecdotes you cannot support from that data. If first-hand detail is thin, write only at the level the data supports rather than fabricating. Lead each section answer-first. Naturally target the main buyer-intent keyword for this product in the title, the first paragraph, and one H2. ${BANNED_RULE}\n${learnBlock}`

  const userPrompt = `Write a complete, SEO- and AI-Overview-optimized affiliate review blog post about ONE product.
${angle ? `ANGLE / FOCUS: ${angle}\n` : ''}${category ? `CATEGORY: ${category}\n` : ''}
PRODUCT
- Name: ${productName}
- Marketing description: ${(pDescription || '').slice(0, 800) || 'n/a'}
- Key features: ${bullets.slice(0, 8).join(' · ') || 'n/a'}

RESEARCH (web + real owner sentiment — ground real-world pros/cons and use cases here; for any specific number, spec, or claim, only include it if it appears in this data):
${(research || '').slice(0, 3500) || 'n/a'}

Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "title": "<= 65 char SEO title targeting the buyer keyword, no banned words",
  "meta_description": "150-160 char compelling meta description, no banned words",
  "target_keyword": "the main keyword you targeted",
  "hero_prompt": "one vivid sentence describing an editorial, text-free HERO photo of this product's CATEGORY — clean, aspirational, magazine-style (no people required, no logos, no text)",
  "intro_html": "1-2 short intro paragraphs as raw HTML <p>...</p> (first person, answer-first hook)",
  "body_html": "700-1100 words as raw HTML <p>/<h2>/<ul><li> blocks. Real benefits, who it's for, how it's used, set-up, and trade-offs — specific and grounded, answer-first under each H2. No fabricated claims, no banned words.",
  "pros": ["3-5 concrete pros grounded in the data"],
  "cons": ["2-3 real drawbacks/limitations grounded in the data (every product has trade-offs)"],
  "verdict": "one punchy bottom-line sentence",
  "faq": [ { "q": "buyer question", "a": "answer-first 2-4 sentence answer" } ]  // 4-5 FAQs
}`

  let parsed: {
    title: string; meta_description: string; target_keyword?: string; hero_prompt?: string
    intro_html: string; body_html: string; pros?: string[]; cons?: string[]; verdict?: string
    faq?: Array<{ q: string; a: string }>
  }
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: sys,
      messages: [{ role: 'user', content: userPrompt }],
    })
    recordUsage({ ...usageFromAnthropic(msg), userId: user.id, tier, feature: 'from_link_post', model: 'claude-sonnet-4-6' })
    const raw = (msg.content[0] as { type: string; text: string }).text
    const j = raw.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(j?.[0] ?? raw)
  } catch (err) {
    return NextResponse.json({ error: `Writing failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 502 })
  }

  // ── 4. Assemble the WordPress (Gutenberg) HTML ──────────────────────────────
  const wpService = createWordPressService(site.wordpress_url ?? '', site.wordpress_username ?? '', site.wordpress_app_password ?? '')
  const scrub = (s: string) => scrubBanned(s || '')
  const title = scrub(parsed.title) || `${productName} Review`
  const slug = slugify(title)

  let bodyHtml = ''
  // Affiliate disclosure banner.
  bodyHtml += `<!-- wp:group {"style":{"color":{"background":"#fffbe6"},"spacing":{"padding":{"top":"16px","bottom":"16px","left":"20px","right":"20px"}},"border":{"left":{"color":"#FFC200","width":"4px"}}},"layout":{"type":"constrained"}} -->\n<div class="wp-block-group has-background" style="border-left-color:#FFC200;border-left-width:4px;background-color:#fffbe6;padding:16px 20px"><!-- wp:paragraph {"style":{"typography":{"fontSize":"13px"}}} --><p style="font-size:13px">${scrub(disclaimer)}</p><!-- /wp:paragraph --></div>\n<!-- /wp:group -->\n`
  bodyHtml += `${scrub(parsed.intro_html)}\n`

  // Top CTA button (if we have an affiliate link).
  const ctaButton = (label: string) => affiliateUrl
    ? `<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button {"backgroundColor":"vivid-amber"} --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${affiliateUrl}" target="_blank" rel="nofollow sponsored noopener">${scrub(label)}</a></div><!-- /wp:button --></div><!-- /wp:buttons -->\n`
    : ''
  bodyHtml += ctaButton(`Check price → ${productName.split(',')[0].slice(0, 40)}`)

  bodyHtml += `${scrub(parsed.body_html)}\n`

  // Pros / cons columns.
  const pros = (parsed.pros || []).filter(Boolean)
  const cons = (parsed.cons || []).filter(Boolean)
  if (pros.length || cons.length) {
    const li = (arr: string[]) => arr.map(x => `<li>${scrub(x)}</li>`).join('')
    const prosCol = pros.length ? `<!-- wp:column --><div class="wp-block-column"><!-- wp:paragraph --><p><strong>👍 Pros</strong></p><!-- /wp:paragraph --><!-- wp:list --><ul>${li(pros)}</ul><!-- /wp:list --></div><!-- /wp:column -->` : ''
    const consCol = cons.length ? `<!-- wp:column --><div class="wp-block-column"><!-- wp:paragraph --><p><strong>👎 Cons</strong></p><!-- /wp:paragraph --><!-- wp:list --><ul>${li(cons)}</ul><!-- /wp:list --></div><!-- /wp:column -->` : ''
    bodyHtml += `<!-- wp:columns --><div class="wp-block-columns">${prosCol}${consCol}</div><!-- /wp:columns -->\n`
  }
  if (parsed.verdict) {
    bodyHtml += `<!-- wp:paragraph {"style":{"typography":{"fontStyle":"italic"}}} --><p><em>👉 ${scrub(parsed.verdict)}</em></p><!-- /wp:paragraph -->\n`
  }
  bodyHtml += ctaButton(`See it on the store →`)

  // FAQ.
  if (Array.isArray(parsed.faq) && parsed.faq.length) {
    bodyHtml += `<!-- wp:heading --><h2>Frequently asked questions</h2><!-- /wp:heading -->\n`
    for (const f of parsed.faq) {
      if (!f?.q) continue
      bodyHtml += `<!-- wp:heading {"level":3} --><h3>${scrub(f.q)}</h3><!-- /wp:heading -->\n<!-- wp:paragraph --><p>${scrub(f.a)}</p><!-- /wp:paragraph -->\n`
    }
  }

  // ── 5. Hero / featured image (text-free, brand-free) ────────────────────────
  let featuredMedia: number | undefined
  try {
    if (process.env.FAL_KEY) {
      fal.config({ credentials: process.env.FAL_KEY })
      const heroPrompt = `${parsed.hero_prompt || `An editorial hero photo representing ${title}`}. Bright, aspirational, magazine-style editorial photography, clean composition, premium lighting, photorealistic. ${NO_BRAND_IMAGE_CLAUSE} No text, no words, no letters, no logos anywhere.`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await fal.subscribe('fal-ai/flux-pro/v1.1' as any, {
        input: { prompt: heroPrompt, image_size: 'landscape_16_9', num_inference_steps: 28, guidance_scale: 3.5, num_images: 1, output_format: 'jpeg', safety_tolerance: '2' },
        pollInterval: 3000,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const heroSrc = ((r.data as any)?.images as Array<{ url: string }> | undefined)?.[0]?.url ?? null
      if (heroSrc) {
        recordUsage({ userId: user.id, tier, feature: 'from_link_hero_image', model: 'fal-flux-pro-v1.1', images: 1 })
        const media = await wpService.uploadImageFromUrl(heroSrc, `${slug}-hero.jpg`)
        if (media?.id) featuredMedia = media.id
      }
    }
  } catch { /* publish without a hero rather than fail */ }

  // ── 6. JSON-LD (BlogPosting + FAQPage) ──────────────────────────────────────
  const siteBase = (site.wordpress_url || '').replace(/\/$/, '')
  const postUrl = `${siteBase}/${slug}/`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graph: any[] = [{
    '@type': 'BlogPosting',
    headline: title,
    description: scrub(parsed.meta_description),
    datePublished: new Date().toISOString(),
    mainEntityOfPage: postUrl,
    author: { '@type': 'Person', name: (brand?.author_name as string) || (brand?.name as string) || 'Editor' },
  }]
  if (Array.isArray(parsed.faq) && parsed.faq.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: parsed.faq.filter(f => f?.q).map(f => ({ '@type': 'Question', name: scrub(f.q), acceptedAnswer: { '@type': 'Answer', text: scrub(f.a) } })),
    })
  }
  const jsonld = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })

  // ── 7. Publish to WordPress ─────────────────────────────────────────────────
  let wpPost
  try {
    wpPost = await wpService.createPost({
      title,
      content: bodyHtml,
      excerpt: scrub(parsed.meta_description),
      slug,
      status: 'publish',
      ...(featuredMedia ? { featured_media: featuredMedia } : {}),
      meta: { mvp_meta_description: scrub(parsed.meta_description), mvp_jsonld: jsonld },
    })
  } catch (err) {
    return NextResponse.json({ error: `WordPress publish failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 502 })
  }

  void pingIndexNowForUrl(supabase, ownerId, wpPost.link, siteId).catch(() => {})

  // ── 8. Hallucination guards (research is the source budget) ─────────────────
  let bodyAfterChecks = bodyHtml
  try {
    const claudeSvc = createClaudeService()
    const sourceResearch = `Product: ${productName}\nDescription: ${(pDescription || '').slice(0, 800)}\nBullets:\n${bullets.slice(0, 10).join('\n')}\n\nResearch:\n${(research || '').slice(0, 6000)}`.slice(0, 12000)
    try {
      const checked = await claudeSvc.factCheckProductClaims(bodyAfterChecks, '', sourceResearch, { userId: user.id, tier })
      if (checked && checked !== bodyAfterChecks) bodyAfterChecks = scrub(checked)
    } catch { /* non-fatal */ }
    try {
      const guarded = await claudeSvc.citationGuard(bodyAfterChecks, '', sourceResearch, { userId: user.id, tier })
      if (guarded && guarded !== bodyAfterChecks) bodyAfterChecks = scrub(guarded)
    } catch { /* non-fatal */ }
    if (bodyAfterChecks !== bodyHtml) {
      try { await wpService.updatePost(wpPost.id, { content: bodyAfterChecks }) } catch { /* keep prior text */ }
    }
  } catch { /* published post stands */ }

  // ── 9. Save the blog_posts row (no video; treated as a normal review) ───────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('blog_posts').insert({
    user_id: ownerId,
    video_id: null,
    title,
    slug,
    content: bodyAfterChecks,
    excerpt: scrub(parsed.meta_description),
    status: 'published',
    post_type: 'review',
    wordpress_post_id: wpPost.id,
    wordpress_url: wpPost.link,
    ...(site.site_id !== 'legacy' ? { wordpress_site_id: site.site_id } : {}),
    ai_model: 'claude-sonnet-4-6',
    generation_prompt_version: 'from-link-v1',
    published_at: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true, url: wpPost.link, postId: wpPost.id, title, targetKeyword: parsed.target_keyword ?? null })
}
