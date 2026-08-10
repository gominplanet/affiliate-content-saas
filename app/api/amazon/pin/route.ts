// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/amazon/pin — publish a Pinterest Pin from an MVP Art Director
// thumbnail + a product link. Unlike the blog pin path (which forces the Pin to
// point at a WordPress post), this points the Pin straight at the creator's
// geni.us affiliate link — the whole point of the Amazon Influencer flow.
//
// Body: { imageUrl, productUrl?, asin?, productTitle?, boardId?, title?, description? }
//   imageUrl   — required, the thumbnail to pin (fal-hosted URL from the generator)
//   productUrl / asin — the product to link to (affiliate)
//   title / description — optional; blank → the AI writes them
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { PinterestService } from '@/services/pinterest'
import { createGeniuslinkService } from '@/services/geniuslink'
import { getOrCreateAmazonGeniuslink } from '@/lib/geniuslink-cache'
import { asinFromAmazonUrl, resolveFinalUrl } from '@/lib/product-link'
import { fetchAmazonProduct } from '@/services/amazon'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { scrubBanned } from '@/lib/scrub'

export const maxDuration = 60

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    imageUrl?: string; productUrl?: string; asin?: string; productTitle?: string
    boardId?: string; title?: string; description?: string
  }
  if (!body.imageUrl) return NextResponse.json({ error: 'A thumbnail image is required. Generate one first.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawInt } = await supabase
    .from('integrations')
    .select('tier,pinterest_access_token,pinterest_board_id,geniuslink_api_key,geniuslink_api_secret,amazon_associates_tag')
    .eq('user_id', user.id).single()
  const intRow = decryptIntegrationRow(rawInt)
  const tier = (intRow?.tier as Tier) ?? 'trial'

  if (!tierAllowsSocial(tier, 'pinterest')) {
    return NextResponse.json({ error: 'Pinterest posting is on the Amazon, Studio and Pro plans.' }, { status: 403 })
  }
  if (!intRow?.pinterest_access_token) {
    return NextResponse.json({ error: 'Connect your Pinterest account first (Set up → Connect Socials).', needsConnect: true }, { status: 409 })
  }

  // ── Resolve the product ASIN + build the affiliate destination ────────────
  let asin = (body.asin || '').trim().toUpperCase() || asinFromAmazonUrl(body.productUrl || '')
  if (!asin && body.productUrl && /(?:geni\.us|amzn\.to|a\.co|bit\.ly)/i.test(body.productUrl)) {
    try { asin = asinFromAmazonUrl(await resolveFinalUrl(body.productUrl)) } catch { /* leave null */ }
  }
  const tag = intRow.amazon_associates_tag as string | undefined
  const destination = asin
    ? `https://www.amazon.com/dp/${asin}${tag ? `?tag=${tag}` : ''}`
    : (body.productUrl || '')

  // ── Geniuslink the destination (cache-first by ASIN) ──────────────────────
  let linkUrl = destination
  let geniuslinkNote: string | null = null
  if (intRow.geniuslink_api_key && intRow.geniuslink_api_secret && destination) {
    try {
      const svc = createGeniuslinkService(intRow.geniuslink_api_key as string, intRow.geniuslink_api_secret as string)
      if (asin) {
        const { url } = await getOrCreateAmazonGeniuslink({ userId: user.id, asin, destination, service: svc, note: body.productTitle || asin })
        linkUrl = url
      } else {
        linkUrl = await svc.createLink(destination, body.productTitle || 'product')
      }
    } catch (e) {
      geniuslinkNote = `Geniuslink hiccup — used your plain affiliate link instead. ${e instanceof Error ? e.message : ''}`.trim()
    }
  }
  if (!linkUrl) return NextResponse.json({ error: 'No product link to pin to. Paste an Amazon link or ASIN.' }, { status: 400 })

  // ── Product title (for the caption) — best-effort ─────────────────────────
  let productTitle = (body.productTitle || '').trim()
  if (!productTitle && asin) {
    try { productTitle = (await fetchAmazonProduct(asin)).title || '' } catch { /* ignore */ }
  }

  // ── Pin title + description (AI-written when the caller leaves them blank) ─
  let title = (body.title || '').trim()
  let description = (body.description || '').trim()
  if (!title || !description) {
    try {
      const anthropic = createAnthropicClient()
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: 'You write high-CTR Pinterest Pins for Amazon product finds. Return STRICT JSON {"title","description"}. title ≤ 90 chars, punchy and keyword-rich. description ≤ 400 chars, benefit-led, ending with 2–4 relevant hashtags. No price claims, no "cheap", no fake urgency. No markdown, JSON only.',
        messages: [{ role: 'user', content: `PRODUCT: ${productTitle || body.productUrl || 'an Amazon find'}\n\nWrite the Pin JSON now.` }],
      })
      recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'amazon_pin_caption', model: 'claude-haiku-4-5-20251001' })
      const raw = (msg.content[0] as { type: string; text?: string }).text || ''
      const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { title?: string; description?: string }
      if (!title) title = scrubBanned(String(j.title || '').trim()).slice(0, 100)
      if (!description) description = scrubBanned(String(j.description || '').trim()).slice(0, 500)
    } catch { /* fall back to product title below */ }
  }
  if (!title) title = (productTitle || 'Amazon find').slice(0, 100)
  if (!description) description = (productTitle || '').slice(0, 500)

  // ── Publish the Pin ───────────────────────────────────────────────────────
  try {
    const pinterest = new PinterestService(intRow.pinterest_access_token as string)
    const boardId = (body.boardId || (intRow.pinterest_board_id as string | undefined) || '').trim()
      || (await pinterest.findOrCreateBoard('Reviews')).id
    const { id: pinId } = await pinterest.createPin({ boardId, title, description, imageUrl: body.imageUrl, link: linkUrl })
    return NextResponse.json({
      ok: true,
      pinId,
      pinUrl: `https://www.pinterest.com/pin/${pinId}/`,
      title,
      description,
      linkUrl,
      geniuslinkNote,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Pinterest pin failed' }, { status: 500 })
  }
}
