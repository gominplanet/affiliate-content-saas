// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared Pinterest-pin publish + copy logic for the Amazon Influencer flow.
// Used by three callers so they never drift: the immediate publish route
// (/api/amazon/pin), the copy pre-fill endpoint (/api/amazon/pin-copy), and the
// scheduler cron (process-amazon-schedules). Points the Pin straight at the
// creator's geni.us affiliate link (not a blog post).
import { PinterestService } from '@/services/pinterest'
import { createGeniuslinkService } from '@/services/geniuslink'
import { getOrCreateAmazonGeniuslink } from '@/lib/geniuslink-cache'
import { asinFromAmazonUrl, resolveFinalUrl } from '@/lib/product-link'
import { fetchAmazonProduct } from '@/services/amazon'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { scrubBanned } from '@/lib/scrub'
import type { Tier } from '@/lib/tier'

export interface PinIntegration {
  pinterest_access_token?: string | null
  pinterest_board_id?: string | null
  geniuslink_api_key?: string | null
  geniuslink_api_secret?: string | null
  amazon_associates_tag?: string | null
}

/** Best-effort product title from an ASIN (for grounding the copy). */
async function productTitleFor(asin: string, given?: string): Promise<string> {
  const t = (given || '').trim()
  if (t) return t
  if (!asin) return ''
  try { return (await fetchAmazonProduct(asin)).title || '' } catch { return '' }
}

/**
 * Write a high-CTR Pin title + description with Haiku. Returns blanks-filled
 * copy the caller can show in the boxes OR publish directly. Cheap (~$0.001).
 */
export async function writePinCopy(opts: {
  userId: string
  tier: Tier
  productTitle?: string
  productUrl?: string
  asin?: string
}): Promise<{ title: string; description: string }> {
  const asin = (opts.asin || '').trim().toUpperCase()
  const productTitle = await productTitleFor(asin, opts.productTitle)
  let title = ''
  let description = ''
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: 'You write high-CTR Pinterest Pins for product finds. Return STRICT JSON {"title","description"}. title ≤ 90 chars, punchy and keyword-rich. description ≤ 400 chars, benefit-led, ending with 2–4 relevant hashtags. No price claims, no "cheap", no fake urgency. No markdown, JSON only.',
      messages: [{ role: 'user', content: `PRODUCT: ${productTitle || opts.productUrl || 'a great find'}\n\nWrite the Pin JSON now.` }],
    })
    recordAnthropicUsage(msg, { userId: opts.userId, tier: opts.tier, feature: 'amazon_pin_caption', model: 'claude-haiku-4-5-20251001' })
    const raw = (msg.content[0] as { type: string; text?: string }).text || ''
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { title?: string; description?: string }
    title = scrubBanned(String(j.title || '').trim()).slice(0, 100)
    description = scrubBanned(String(j.description || '').trim()).slice(0, 500)
  } catch { /* fall back below */ }
  if (!title) title = (productTitle || 'Great find').slice(0, 100)
  if (!description) description = (productTitle || '').slice(0, 500)
  return { title, description }
}

export interface PublishPinResult {
  pinId: string
  pinUrl: string
  title: string
  description: string
  linkUrl: string
  geniuslinkNote: string | null
}

/**
 * Publish one Pin: resolve the ASIN, geni.us the affiliate destination, write
 * the copy if the caller left it blank, then create the Pin on the chosen board.
 * Throws on a hard failure (no token, no link, Pinterest error).
 */
export async function publishAmazonPin(opts: {
  userId: string
  tier: Tier
  intRow: PinIntegration
  imageUrl: string
  asin?: string
  productUrl?: string
  productTitle?: string
  boardId?: string
  title?: string
  description?: string
}): Promise<PublishPinResult> {
  const { intRow } = opts
  if (!intRow.pinterest_access_token) throw new Error('Pinterest is not connected.')

  // Resolve ASIN + affiliate destination.
  let asin = (opts.asin || '').trim().toUpperCase() || asinFromAmazonUrl(opts.productUrl || '') || ''
  if (!asin && opts.productUrl && /(?:geni\.us|amzn\.to|a\.co|bit\.ly)/i.test(opts.productUrl)) {
    try { asin = asinFromAmazonUrl(await resolveFinalUrl(opts.productUrl)) || '' } catch { /* leave blank */ }
  }
  const tag = intRow.amazon_associates_tag || undefined
  const destination = asin
    ? `https://www.amazon.com/dp/${asin}${tag ? `?tag=${tag}` : ''}`
    : (opts.productUrl || '')

  // Geniuslink the destination (cache-first by ASIN).
  let linkUrl = destination
  let geniuslinkNote: string | null = null
  if (intRow.geniuslink_api_key && intRow.geniuslink_api_secret && destination) {
    try {
      const svc = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
      if (asin) {
        const { url } = await getOrCreateAmazonGeniuslink({ userId: opts.userId, asin, destination, service: svc, note: opts.productTitle || asin })
        linkUrl = url
      } else {
        linkUrl = await svc.createLink(destination, opts.productTitle || 'product')
      }
    } catch (e) {
      geniuslinkNote = `Geniuslink hiccup — used your plain affiliate link instead. ${e instanceof Error ? e.message : ''}`.trim()
    }
  }
  if (!linkUrl) throw new Error('No product link to pin to. Paste an Amazon link or ASIN.')

  // Copy — use what the caller passed, else auto-write.
  let title = (opts.title || '').trim()
  let description = (opts.description || '').trim()
  if (!title || !description) {
    const written = await writePinCopy({ userId: opts.userId, tier: opts.tier, productTitle: opts.productTitle, productUrl: opts.productUrl, asin })
    if (!title) title = written.title
    if (!description) description = written.description
  }

  // Publish.
  const pinterest = new PinterestService(intRow.pinterest_access_token)
  const boardId = (opts.boardId || intRow.pinterest_board_id || '').trim()
    || (await pinterest.findOrCreateBoard('Reviews')).id
  const { id: pinId } = await pinterest.createPin({ boardId, title, description, imageUrl: opts.imageUrl, link: linkUrl })
  return { pinId, pinUrl: `https://www.pinterest.com/pin/${pinId}/`, title, description, linkUrl, geniuslinkNote }
}
