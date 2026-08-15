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
import { fetchKeepaProductCard } from '@/services/keepa'
import { resolveAffiliateUrl } from '@/lib/weekly-digest'
import { fetchIdeaList, normalizeListUrl, cleanListName } from '@/lib/amazon-idea-list'
import { buildCampaignHero } from '@/lib/hero-image'
import { scrubAiHtml } from '@/lib/html-scrub'
import { toUserMessage } from '@/lib/friendly-error'

export const runtime = 'nodejs'
export const maxDuration = 300

const DISCLOSURE = 'As an Amazon Associate I earn from qualifying purchases. This post contains affiliate links, and I may earn a commission at no extra cost to you.'
const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const dollars = (cents: number | null) => (cents == null ? null : `$${(cents / 100).toFixed(2)}`)

interface InItem { asin: string; title?: string | null; image?: string | null }
interface Enriched {
  asin: string; title: string; image: string | null
  priceCents: number | null; rating: number | null; reviews: number | null
  discountPct: number | null; monthlySold: number | null
  earnings: number; hasCampaign: boolean; score: number
}

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
      url?: string; items?: InItem[]; listTitle?: string; listUrl?: string; count?: number; listId?: string
    }
    const count = Math.max(3, Math.min(20, Number(body.count) || 10))

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
    const asins = Array.from(new Set(inItems.map(i => String(i.asin || '').trim().toUpperCase()).filter(a => /^[A-Z0-9]{10}$/.test(a)))).slice(0, 60)
    if (asins.length < 3) return NextResponse.json({ error: 'Need at least 3 products from the list.' }, { status: 400 })
    const titleByAsin = new Map(inItems.map(i => [String(i.asin).toUpperCase(), (i.title || '').trim()]))
    const imageByAsin = new Map(inItems.map(i => [String(i.asin).toUpperCase(), i.image || null]))

    // 2. Which of these already earn for the creator (SCOUT), and which are in a
    //    CC campaign — both boost the score.
    const [{ data: earnRows }, { data: campRows }] = await Promise.all([
      sb.from('storefront_earnings').select('asin,commission').eq('user_id', user.id).in('asin', asins),
      sb.from('campaigns').select('asin').eq('user_id', user.id).in('asin', asins),
    ])
    const earnByAsin = new Map<string, number>()
    for (const r of (earnRows || []) as Array<{ asin: string; commission: number | null }>) {
      earnByAsin.set(r.asin, (earnByAsin.get(r.asin) || 0) + (Number(r.commission) || 0))
    }
    const campaignAsins = new Set((campRows || []).map((r: { asin: string }) => r.asin))

    // 3. Keepa-enrich (paced), then score.
    const cards = await pool(asins, 6, async (asin) => {
      let k = null
      try { k = await fetchKeepaProductCard(asin) } catch { /* degrade */ }
      return { asin, k }
    })
    const enriched: Enriched[] = cards.map(({ asin, k }) => ({
      asin,
      title: titleByAsin.get(asin) || `Amazon product ${asin}`,
      image: imageByAsin.get(asin) || (k?.imageUrl ?? null),
      priceCents: k?.priceNowCents ?? null,
      rating: k?.rating ?? null,
      reviews: k?.reviewCount ?? null,
      discountPct: k?.discountPct ?? null,
      monthlySold: k?.monthlySold ?? null,
      earnings: earnByAsin.get(asin) || 0,
      hasCampaign: campaignAsins.has(asin),
      score: 0,
    }))
    // Normalize each signal 0..1 across the set, then weight.
    const max = (f: (e: Enriched) => number) => Math.max(1, ...enriched.map(f))
    const mSold = max(e => e.monthlySold || 0), mEarn = max(e => e.earnings), mRev = max(e => Math.log10((e.reviews || 0) + 1))
    for (const e of enriched) {
      const demand = (e.monthlySold || 0) / mSold
      const earn = e.earnings / mEarn
      const deal = Math.min(1, (e.discountPct || 0) / 40)
      const trust = ((e.rating || 0) / 5) * (Math.log10((e.reviews || 0) + 1) / mRev)
      e.score = earn * 0.34 + demand * 0.26 + trust * 0.20 + deal * 0.12 + (e.hasCampaign ? 0.08 : 0)
    }
    const picks = enriched.sort((a, b) => b.score - a.score).slice(0, count)

    // 4. Claude writes the prose (JSON only — we own the HTML + links).
    const anthropic = createAnthropicClient()
    const angle = cleanListName(listTitle) || listTitle || 'a curated Amazon shopping list'
    const year = new Date().getUTCFullYear()
    const prompt = `You are writing a SHOPPING GUIDE blog post — a curated "here are the best picks" listicle, NOT a head-to-head comparison. The Amazon list this is based on is themed: "${angle}".
Here are the ${picks.length} products, already chosen, in order:
${picks.map((p, i) => `${i + 1}. ${p.title}${p.priceCents ? ` (${dollars(p.priceCents)})` : ''}${p.rating ? ` ${p.rating}★ ${p.reviews || 0} reviews` : ''}`).join('\n')}

Return ONLY JSON with these fields:
{
  "title": string  — a compelling, SEO-friendly blog TITLE for a shopping guide (e.g. "The 10 Best Office & Studio Essentials for ${year}"). Do NOT reuse the raw list name, and NEVER include "Amazon Page", a person's handle, warning symbols, or emojis.
  "hero_prompt": string — one vivid sentence describing a clean, aspirational, magazine-style HERO photo representing this guide's theme (a styled scene of the product category; NO people, NO text, NO logos). e.g. "A tidy modern home-office desk at golden hour with a monitor, desk lamp and ergonomic chair".
  "intro": string — 2-4 warm sentences setting up the guide and who it's for.
  "conclusion": string — 3-4 sentences wrapping up the whole guide: recap the theme, remind the reader how to choose between the picks (who each is best for), and end on an encouraging note. This is the closing section of the post, so make it feel like a real sign-off, not a throwaway line.
  "picks": [{
    "asin": string,
    "heading": string — short, the product's ROLE (e.g. "Best budget monitor", "Best ergonomic chair"),
    "superlative": string — 2-4 words (e.g. "Best Value", "Editor's Pick", "Best for small spaces"),
    "blurb": string — 5-6 sentences. Lead with what it IS in one line, then 3-4 concrete FEATURES each tied to a BENEFIT (feature → why it actually matters to the buyer in daily use), then close with who it's best for. Warm, specific and persuasive. Never generic filler, never repeat the heading.
  }]
}
Match each picks[].asin to one of these: ${picks.map(p => p.asin).join(', ')}. Do not invent products, prices, or specs you don't see above. No markdown — JSON only.`
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 10000,
      messages: [{ role: 'user', content: prompt }],
    })
    recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'idea_list_guide', model: 'claude-sonnet-4-6' })
    const raw = msg.content.map(c => (c.type === 'text' ? c.text : '')).join('')
    let parsed: { title?: string; hero_prompt?: string; intro?: string; conclusion?: string; outro?: string; picks?: Array<{ asin: string; heading?: string; superlative?: string; blurb?: string }> } = {}
    try { parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) } catch { /* fall back below */ }
    const proseByAsin = new Map((parsed.picks || []).map(p => [String(p.asin).toUpperCase(), p]))

    // 5. Assemble the post: intro, a card per pick, outro, full-list CTA + disclosure.
    const tag = (intRow?.amazon_associates_tag as string) || null
    const links = await pool(picks, 5, async (p) => ({ asin: p.asin, url: await resolveAffiliateUrl(p.asin, p.title, tag, intRow?.geniuslink_api_key ?? null, intRow?.geniuslink_api_secret ?? null) }))
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
      const hero = await buildCampaignHero({
        heroPrompt: parsed.hero_prompt || `A clean, aspirational magazine-style editorial hero photo representing ${angle} — a styled scene of the product category, no people, no text, no logos`,
        productImageUrl: picks.find(p => p.image)?.image ?? null,
        productTitle: angle,
        // A guide's hero is a category SCENE, not one product — don't reject it
        // for failing to match a single pick (that's what forced a bare product
        // photo before). The product image stays only as a last-resort floor.
        verifyProduct: false,
        ctx: { userId: user.id, tier },
      })
      if (hero?.b64) {
        const media = await wp.uploadImageFromBase64(hero.b64, `${slug || 'shopping-guide'}.jpg`, 'image/jpeg')
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

    return NextResponse.json({ ok: true, url: wpPost.link, title: postTitle, picked: picks.length, postId, wpPostId: wpPost.id })
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err, "Couldn't build the guide just now. Please try again in a moment.") }, { status: 500 })
  }
}
