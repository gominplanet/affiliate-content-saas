// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/idea-list/generate
//   { url?, items?: {asin,title,image}[], listTitle?, listUrl?, count? }
//
// Turn an Amazon idea list into a SHOPPING-GUIDE post (not a comparison):
//   1. Resolve the list's products (from SCOUT items, or by reading a URL).
//   2. Keepa-enrich each (price, rating, reviews, discount, demand).
//   3. Score by the user's own sales (SCOUT earnings) + demand + deal + CC
//      campaign match + trust, pick the top N.
//   4. Claude writes the intro, a "best for" line + blurb per pick, and an outro.
//   5. We assemble the card HTML (image + price + rating + affiliate button),
//      add a CTA to the FULL list on Amazon, publish to WordPress.
//
// Paid tiers; counts against the monthly generation limit.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, checkGenerationLimit, type Tier } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { enrichAndRankIdeaList, type RankedProduct } from '@/lib/idea-list-rank'
import { resolveAffiliateUrl } from '@/lib/weekly-digest'
import { getLinkStyle } from '@/lib/link-cloak'
import { fetchIdeaList, normalizeListUrl, cleanListName } from '@/lib/amazon-idea-list'
import { buildCampaignHero } from '@/lib/hero-image'
import { generateArtDirectorBlogHero } from '@/lib/art-director-pin'
import { scrubAiHtml } from '@/lib/html-scrub'
import { toUserMessage } from '@/lib/friendly-error'
import { writeContentSchema } from '@/lib/content-schema'

export const runtime = 'nodejs'
export const maxDuration = 300

const DISCLOSURE = 'As an Amazon Associate I earn from qualifying purchases. This post contains affiliate links, and I may earn a commission at no extra cost to you.'
const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const dollars = (cents: number | null) => (cents == null ? null : `$${(cents / 100).toFixed(2)}`)

interface InItem { asin: string; title?: string | null; image?: string | null }

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []; let i = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) }
  })
  await Promise.all(workers)
  return out
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    const { data: intRow } = await sb.from('integrations')
      .select('tier,amazon_associates_tag,geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id).maybeSingle()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (tier === 'trial') return NextResponse.json({ error: 'Turning idea lists into posts is a paid feature.' }, { status: 403 })

    const spendBlocked = await spendGate(user.id, tier)
    if (spendBlocked) return spendBlocked
    const gen = await checkGenerationLimit(supabase, user.id)
    if (!gen.allowed) return NextResponse.json({ error: gen.reason, limitReached: true, cap: 'generations', currentTier: gen.tier, upgrade: gen.upgrade }, { status: 429 })

    const body = await request.json().catch(() => ({})) as {
      url?: string; items?: InItem[]; listTitle?: string; listUrl?: string; count?: number; listId?: string; asins?: string[]
      headlineStyle?: 'statement' | 'question'
    }
    const count = Math.max(3, Math.min(20, Number(body.count) || 10))
    const heroHeadlineStyle = body.headlineStyle === 'question' ? 'question' : 'statement'

    // 1. Resolve the source products, in order of preference:
    //    a synced list (SCOUT, full set) → inline items → read the URL (first ~20).
    let inItems: InItem[] = Array.isArray(body.items) ? body.items : []
    let listTitle = (body.listTitle || '').trim()
    let listUrl = normalizeListUrl(body.listUrl || body.url || '')
    if (inItems.length === 0 && (body.listId || '').trim()) {
      const { data: row } = await sb.from('idea_lists')
        .select('title,url,items').eq('id', body.listId!.trim()).eq('user_id', user.id).maybeSingle()
      if (!row) return NextResponse.json({ error: 'That synced list is no longer available.' }, { status: 404 })
      inItems = Array.isArray(row.items) ? row.items : []
      if (!listTitle && row.title) listTitle = row.title
      if (!listUrl && row.url) listUrl = normalizeListUrl(row.url)
    }
    if (inItems.length === 0 && (body.url || '').trim()) {
      const parsed = await fetchIdeaList(body.url!.trim())
      inItems = parsed.items
      if (!listTitle && parsed.title) listTitle = parsed.title
    }
    // Manual mode: the creator hand-picked ASINs — use exactly those, in their
    // order, and the writer keeps every one. We flag them as priority so they're
    // always enriched even if they sit deep in the list.
    const rawManual = Array.isArray(body.asins)
      ? Array.from(new Set(body.asins.map(a => String(a || '').trim().toUpperCase()))).filter(a => /^[A-Z0-9]{10}$/.test(a))
      : []

    // 2. Rank the whole list with MVP's criteria (CC-campaign products first,
    //    then price / rating / reviews / demand / deal). Shared with the manual
    //    checklist preview so what the creator sees matches what MVP would pick.
    const { ranked, byAsin } = await enrichAndRankIdeaList(sb, user.id, inItems, { cap: 100, priorityAsins: rawManual })
    if (ranked.length < 3) return NextResponse.json({ error: 'Need at least 3 products from the list.' }, { status: 400 })

    const manualAsins = rawManual.filter(a => byAsin.has(a))
    const isManual = manualAsins.length >= 3
    const candidatePool: RankedProduct[] = isManual
      ? manualAsins.map(a => byAsin.get(a)!).slice(0, count)
      : ranked.slice(0, Math.min(ranked.length, count + 12))

    // 3. Claude writes the prose. In auto mode it also SELECTS the on-theme
    //    line-up; in manual mode it writes for exactly what the creator chose.
    const anthropic = createAnthropicClient()
    const angle = cleanListName(listTitle) || listTitle || 'a curated Amazon shopping list'
    const selectRules = isManual
      ? `The creator has ALREADY chosen these ${candidatePool.length} products. Write about EVERY one, in this exact order — do not drop, add or reorder any.`
      : `SELECT the picks — this is the most important step:
- Choose up to ${count} products that GENUINELY FIT the theme "${angle}". LEAVE OUT anything that doesn't belong in this specific guide, no matter how highly rated — e.g. a child's school backpack has NO place in a content-creator guide. Fewer strong, on-theme picks beats padding with off-theme ones. Only reach ${count} if that many truly fit.
- Among products that fit, PREFER [CC] ones, then higher rating and demand. Order best-first.`
    const prompt = `You are writing a SHOPPING GUIDE blog post — a curated "best picks" listicle. The guide's theme is: "${angle}".

${isManual ? 'PRODUCTS (already chosen by the creator)' : 'CANDIDATE PRODUCTS — choose the line-up from THESE ONLY'}. "[CC]" marks a product the creator earns a campaign bounty on:
${candidatePool.map((p, i) => `${i + 1}. [ASIN ${p.asin}]${p.hasCampaign ? ' [CC]' : ''} ${p.title}${p.priceCents ? ` — ${dollars(p.priceCents)}` : ''}${p.rating ? ` — ${p.rating}★ (${p.reviews || 0} reviews)` : ''}`).join('\n')}

${selectRules}

Return ONLY JSON:
{
  "title": string — compelling, SEO-friendly, EVERGREEN (NEVER a year or date), no "Amazon Page"/handle/warning symbols/emojis, and don't reuse the raw list name.
  "hero_prompt": string — one vivid sentence: a clean, aspirational, magazine-style HERO photo of the guide's product category (no people, no text, no logos).
  "intro": string — 2-4 warm sentences setting up the guide and who it's for.
  "conclusion": string — 3-4 sentences: recap the theme, how to choose between the picks, an encouraging sign-off.
  "picks": [{
    "asin": string — copied EXACTLY from a product above,
    "heading": string — names the REAL product and its role, taken from its title (e.g. "Best wireless lav mic", "Best ring light for video"). NEVER a vague label like "niche creator tool".
    "superlative": string — 2-4 words (e.g. "Best Value", "Best for small spaces"). NEVER "Hidden Gem", "Game Changer", "Must-Have", "You Need This".
    "blurb": string — 5-6 sentences. The FIRST sentence MUST say what the product actually IS (its real category, read from its title). Then specific points a buyer cares about, drawn from the real product and its title — what it does, key features, who it's for.
  }]
}
HARD BAN — generic filler that could describe ANY product. Never write "punches above its price class", "delivers on its promises", "fills a specific role", "just works", "maximum satisfaction per dollar", "consistently delivers", or similar. If all you have is the title, describe the product concretely FROM the title — do not invent specs, but ALWAYS name what it actually is. No markdown — JSON only.`
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 10000,
      messages: [{ role: 'user', content: prompt }],
    })
    recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'idea_list_guide', model: 'claude-sonnet-4-6' })
    const raw = msg.content.map(c => (c.type === 'text' ? c.text : '')).join('')
    let parsed: { title?: string; hero_prompt?: string; intro?: string; conclusion?: string; outro?: string; picks?: Array<{ asin: string; heading?: string; superlative?: string; blurb?: string }> } = {}
    try { parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) } catch { /* fall back below */ }
    const proseByAsin = new Map((parsed.picks || []).map(p => [String(p.asin).toUpperCase(), p]))

    // Final line-up: manual = exactly the creator's picks; auto = the writer's
    // on-theme selection. Fall back to top-ranked only if too few (never < 3).
    let picks: RankedProduct[] = isManual
      ? candidatePool
      : (parsed.picks || [])
          .map(p => byAsin.get(String(p.asin).toUpperCase()))
          .filter((e): e is RankedProduct => !!e)
          .slice(0, count)
    if (picks.length < 3) picks = ranked.slice(0, count)

    // 5. Assemble the post: intro, a card per pick, outro, full-list CTA + disclosure.
    const tag = (intRow?.amazon_associates_tag as string) || null
    // Resolve the creator's link style ONCE, then reuse it for every pick.
    const linkCfg = await getLinkStyle(supabase, user.id)
    const links = await pool(picks, 5, async (p) => ({ asin: p.asin, url: await resolveAffiliateUrl(p.asin, p.title, tag, intRow?.geniuslink_api_key ?? null, intRow?.geniuslink_api_secret ?? null, user.id, linkCfg) }))
    const linkByAsin = new Map(links.map(l => [l.asin, l.url]))

    const postTitle = (parsed.title || cleanListName(listTitle) || 'My Top Picks').slice(0, 120)
    const cardsHtml = picks.map((p, i) => {
      const pr: { heading?: string; superlative?: string; blurb?: string } = proseByAsin.get(p.asin) || {}
      const url = linkByAsin.get(p.asin) || `https://www.amazon.com/dp/${p.asin}`
      const price = dollars(p.priceCents)
      const meta = [price, p.rating ? `${p.rating}★${p.reviews ? ` (${p.reviews.toLocaleString()})` : ''}` : null].filter(Boolean).join(' · ')
      return `<div class="mvp-pick" style="margin:0 0 2rem;padding:1.25rem;border:1px solid #e5e5e5;border-radius:14px;">
<h2 style="margin:0 0 .35rem;">${i + 1}. ${esc(pr.heading || p.title)}</h2>
${pr.superlative ? `<p style="margin:0 0 .75rem;font-weight:600;color:#7C3AED;">${esc(pr.superlative)}</p>` : ''}
${p.image ? `<p style="margin:0 0 .75rem;"><a href="${esc(url)}" target="_blank" rel="nofollow sponsored noopener"><img src="${esc(p.image)}" alt="${esc(p.title)}" style="max-width:280px;height:auto;border-radius:10px;" /></a></p>` : ''}
<p style="margin:0 0 .5rem;">${esc(pr.blurb || p.title)}</p>
${meta ? `<p style="margin:0 0 .85rem;color:#555;">${esc(meta)}</p>` : ''}
<p style="margin:0;"><a href="${esc(url)}" target="_blank" rel="nofollow sponsored noopener" style="display:inline-block;background:#ff9900;color:#111;font-weight:700;padding:.6rem 1.15rem;border-radius:8px;text-decoration:none;">Shop ${esc((pr.heading || p.title).split(' ').slice(0, 3).join(' '))} on Amazon →</a></p>
</div>`
    }).join('\n')

    const fullListCta = listUrl
      ? `<div style="margin:2.5rem 0 1rem;padding:1.25rem;border:2px dashed #ff9900;border-radius:14px;text-align:center;">
<p style="margin:0 0 .75rem;font-weight:600;">Want the whole collection? These are just my top picks.</p>
<a href="${esc(listUrl)}" target="_blank" rel="nofollow sponsored noopener" style="display:inline-block;background:#111;color:#fff;font-weight:700;padding:.7rem 1.4rem;border-radius:8px;text-decoration:none;">See my full list on Amazon →</a>
</div>`
      : ''

    const conclusionText = (parsed.conclusion || parsed.outro || '').trim()
    const conclusionHtml = conclusionText
      ? `<h2 style="margin:2.5rem 0 .75rem;">The bottom line</h2>
<p style="margin:0 0 1rem;">${esc(conclusionText)}</p>`
      : ''

    const content = scrubAiHtml(`<p><em>${DISCLOSURE}</em></p>
<p>${esc(parsed.intro || `Here are my top ${picks.length} picks from ${angle}.`)}</p>
${cardsHtml}
${conclusionHtml}
${fullListCta}`)

    // 6. Featured image — a fresh AI hero for the guide's theme, grounded on the
    //    top pick's photo. Best-effort; a failed hero must never block publishing.
    const creds = await getWordPressCredentials(supabase, user.id)
    if (!creds) return NextResponse.json({ error: 'Connect your WordPress site first.' }, { status: 400 })
    const wp = createWordPressService(creds.wordpress_url, creds.wordpress_username, creds.wordpress_app_password || '', creds.wordpress_api_token || undefined)
    const slug = postTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 70)

    let featuredMedia: number | undefined
    try {
      const topImg = picks.find(p => p.image)?.image ?? null
      let heroB64: string | null = null
      // Primary: the Art Director engine (gpt-image) — the SAME designed-thumbnail
      // look MVP uses for its posts (bold headline + the product, on a styled
      // background), grounded on the top pick and titled with the guide.
      if (topImg) {
        try {
          const ad = await generateArtDirectorBlogHero({
            productImageUrl: topImg, productTitle: postTitle || angle, productContext: angle,
            userId: user.id, tier, headlineStyle: heroHeadlineStyle,
          })
          if (ad?.data) heroB64 = ad.data
        } catch { /* fall through */ }
      }
      // Fallback: an editorial category scene (no product-match requirement).
      if (!heroB64) {
        const hero = await buildCampaignHero({
          heroPrompt: parsed.hero_prompt || `A clean, aspirational magazine-style editorial hero photo representing ${angle} — a styled scene of the product category, no people, no text, no logos`,
          productImageUrl: topImg, productTitle: angle, verifyProduct: false,
          ctx: { userId: user.id, tier },
        })
        if (hero?.b64) heroB64 = hero.b64
      }
      if (heroB64) {
        const media = await wp.uploadImageFromBase64(heroB64, `${slug || 'shopping-guide'}.jpg`, 'image/jpeg')
        featuredMedia = (media?.id as number | undefined) ?? undefined
      }
    } catch (err) { console.warn('[idea-list] hero image failed:', err instanceof Error ? err.message : err) }

    // 7. Publish + save so it's editable/deletable in MVP.
    const wpPost = await wp.createPost({
      title: postTitle, content, excerpt: (parsed.intro || '').slice(0, 160), slug, status: 'publish',
      ...(featuredMedia ? { featured_media: featuredMedia } : {}),
    })

    let postId: string | null = null
    try {
      const { data: saved } = await sb.from('blog_posts').insert({
        user_id: user.id, video_id: null, title: postTitle, slug, content, excerpt: (parsed.intro || '').slice(0, 160),
        wordpress_post_id: wpPost.id, wordpress_url: wpPost.link, wordpress_site_id: (creds as { site_id?: string }).site_id ?? null,
        status: 'published', post_type: 'guide', seo_keyword: angle,
        published_at: new Date().toISOString(),
      }).select('id').single()
      postId = (saved?.id as string) ?? null
    } catch { /* non-fatal — the post is live on WP regardless */ }

    await writeContentSchema(sb, wp, {
      userId: user.id,
      siteUrl: creds.wordpress_url,
      wpPostId: wpPost.id,
      pageUrl: wpPost.link,
      title: postTitle,
      description: (parsed.intro || '').slice(0, 160),
      html: content,
      imageUrl: picks.find(p => p.image)?.image ?? null,
      pageType: 'BlogPosting',
      category: 'Buying Guides',
    })

    return NextResponse.json({ ok: true, url: wpPost.link, title: postTitle, picked: picks.length, postId, wpPostId: wpPost.id })
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err, "Couldn't build the guide just now. Please try again in a moment.") }, { status: 500 })
  }
}
