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
import { resolveGeniuslinkChannelGroupId } from '@/lib/geniuslink-group'
import { createAdminClient } from '@/lib/supabase/admin'
import { passportLinkForUser } from '@/lib/passport-links'
import { getLinkStyle } from '@/lib/link-cloak'
import { geniuslinkCreds } from '@/lib/link-style'
import { shortenBitly } from '@/lib/bitly'
import { asinFromAmazonUrl, resolveFinalUrl } from '@/lib/product-link'
import { pinDestination, isBlockedPinLink, type PinDestinationKind } from '@/lib/pinterest-destination'
import { fetchAmazonProduct } from '@/services/amazon'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { scrubBanned } from '@/lib/scrub'
import type { Tier } from '@/lib/tier'

export interface PinIntegration {
  user_id?: string | null
  pinterest_access_token?: string | null
  pinterest_board_id?: string | null
  pinterest_pin_target?: string | null
  geniuslink_api_key?: string | null
  geniuslink_api_secret?: string | null
  amazon_associates_tag?: string | null
}

// FTC + Amazon Associates Operating Agreement: affiliate posts must disclose.
// This is the exact wording the Associates agreement requires.
const AFFILIATE_DISCLOSURE = 'As an Amazon Associate I earn from qualifying purchases.'

/**
 * Guarantee every published caption carries the affiliate disclosure and the
 * #ad / #sponsored tags, WITHOUT duplicating them if the copy already has them.
 * Runs at publish time so it can't be edited away, and keeps any niche discovery
 * hashtags the copy already includes. Budgeted to stay under `max` chars.
 */
export function finalizeSocialCaption(text: string, max = 500): string {
  let body = (text || '').trim()
  const needDisclosure = !/amazon associate/i.test(body)
  const needAd = !/(^|\s)#ad\b/i.test(body)
  const needSponsored = !/(^|\s)#sponsored\b/i.test(body)

  const bits: string[] = []
  if (needDisclosure) bits.push(AFFILIATE_DISCLOSURE)
  const tags = [needAd ? '#ad' : '', needSponsored ? '#sponsored' : ''].filter(Boolean).join(' ')
  const suffix = [bits.join(' '), tags].filter(Boolean).join(' ')
  if (!suffix) return body.slice(0, max)

  const maxBody = Math.max(0, max - suffix.length - 2)
  if (body.length > maxBody) body = body.slice(0, maxBody).trim()
  return `${body} ${suffix}`.trim().slice(0, max)
}

/**
 * Resolve a product to its affiliate link, shared by every Amazon-social publish
 * path (pin / IG / FB). ASIN → tagged Amazon destination → geni.us short link
 * (cache-first). Returns the best link we can build plus a soft note if
 * Geniuslink hiccuped so the caller can surface it.
 */
export async function resolveAffiliateLink(opts: {
  userId: string
  intRow: PinIntegration
  asin?: string
  productUrl?: string
  productTitle?: string
  /** When set, mint the link into this social channel's Geniuslink group
   *  (MVP-FACEBOOK, …) so clicks attribute per channel. Omit for the default
   *  per-ASIN group. */
  channel?: string
}): Promise<{ linkUrl: string; asin: string; note: string | null }> {
  const { intRow } = opts
  let asin = (opts.asin || '').trim().toUpperCase() || asinFromAmazonUrl(opts.productUrl || '') || ''
  if (!asin && opts.productUrl && /(?:geni\.us|amzn\.to|a\.co|bit\.ly)/i.test(opts.productUrl)) {
    try { asin = asinFromAmazonUrl(await resolveFinalUrl(opts.productUrl)) || '' } catch { /* leave blank */ }
  }
  const tag = intRow.amazon_associates_tag || undefined
  // Passport Links (geo-routing) wins WHEN ON — resolved by userId, so no caller
  // needs to change. Off → null and we fall through to Geniuslink / tag as before.
  if (asin) {
    try {
      const p = await passportLinkForUser(createAdminClient(), opts.userId, asin, { source: opts.channel || 'social', title: opts.productTitle || null })
      if (p) return { linkUrl: p, asin, note: null }
    } catch { /* fall through to normal resolution */ }
  }
  const destination = asin
    ? `https://www.amazon.com/dp/${asin}${tag ? `?tag=${tag}` : ''}`
    : (opts.productUrl || '')

  // The creator's ONE chosen Link style decides how `destination` is cloaked.
  // Passport was handled above; Bitly shortens; Geniuslink only when picked.
  const cfg = await getLinkStyle(createAdminClient(), opts.userId)
  let linkUrl = destination
  let note: string | null = null
  const pinCreds = geniuslinkCreds(cfg, intRow)
  if (cfg.style === 'bitly' && cfg.bitlyToken && destination) {
    const short = await shortenBitly(cfg.bitlyToken, destination)
    if (short) linkUrl = short
  } else if (cfg.style === 'geniuslink' && pinCreds && destination) {
    try {
      const svc = createGeniuslinkService(pinCreds.key, pinCreds.secret)
      // Per-channel attribution: when a channel is given, mint a fresh link in
      // that channel's group (MVP-FACEBOOK, …). This bypasses the per-ASIN cache
      // on purpose — the cache holds one link per ASIN, which can't be split by
      // channel. Without a channel, keep the cached per-ASIN link.
      let channelGroupId: number | null = null
      if (opts.channel) {
        channelGroupId = await resolveGeniuslinkChannelGroupId({
          supabase: createAdminClient(), userId: opts.userId, channel: opts.channel,
          apiKey: intRow.geniuslink_api_key, apiSecret: intRow.geniuslink_api_secret,
        }).catch(() => null)
      }
      if (asin && !opts.channel) {
        const { url } = await getOrCreateAmazonGeniuslink({ userId: opts.userId, asin, destination, service: svc, note: opts.productTitle || asin })
        linkUrl = url
      } else {
        linkUrl = await svc.createLink(destination, opts.productTitle || 'product', channelGroupId ? { groupId: channelGroupId } : undefined)
      }
    } catch (e) {
      note = `Geniuslink hiccup — used your plain affiliate link instead. ${e instanceof Error ? e.message : ''}`.trim()
    }
  }
  return { linkUrl, asin, note }
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
      system: 'You write high-CTR Pinterest Pins for product finds. Return STRICT JSON {"title","description"}. title ≤ 90 chars, punchy and keyword-rich. description ≤ 350 chars, benefit-led, then 4–6 relevant NICHE hashtags for discovery (specific to the product category, e.g. #skincareroutine #vitaminc), then #ad #sponsored, then the exact text "As an Amazon Associate I earn from qualifying purchases." No price claims, no "cheap", no fake urgency. No markdown, JSON only.',
      messages: [{ role: 'user', content: `PRODUCT: ${productTitle || opts.productUrl || 'a great find'}\n\nWrite the Pin JSON now.` }],
    })
    recordAnthropicUsage(msg, { userId: opts.userId, tier: opts.tier, feature: 'amazon_pin_caption', model: 'claude-haiku-4-5-20251001' })
    const raw = (msg.content[0] as { type: string; text?: string }).text || ''
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { title?: string; description?: string }
    title = scrubBanned(String(j.title || '').trim()).slice(0, 100)
    description = scrubBanned(String(j.description || '').trim())
  } catch { /* fall back below */ }
  if (!title) title = (productTitle || 'Great find').slice(0, 100)
  // Guarantee the disclosure + #ad #sponsored no matter what the model returned.
  description = finalizeSocialCaption(description || productTitle || '')
  return { title, description }
}

export interface PublishPinResult {
  pinId: string
  pinUrl: string
  title: string
  description: string
  /** Where the PIN points: a page the creator owns. Never an affiliate link. */
  linkUrl: string
  /** What that page sends the shopper to. Reporting only one of these is how
   *  the mismatch stayed invisible until Pinterest rejected a push. */
  affiliateUrl: string
  destinationKind: PinDestinationKind
  geniuslinkNote: string | null
}

/**
 * Resolve the page this pin should land on, and make sure the product is
 * actually on it first.
 *
 * The tile write is deliberately before the pin: a pin advertising a product
 * that is not on the page it lands on is worse than no pin.
 */
async function resolvePinDestinationFor(opts: {
  userId: string
  intRow: PinIntegration
  asin: string
  productTitle?: string
  imageUrl?: string
  affiliateUrl: string
}) {
  const admin = createAdminClient()
  let shopHandle: string | null = null
  // Read the homepage here rather than off intRow: callers select a narrow
  // column set for the Pinterest token and tag, so wordpress_url is not on it
  // and the homepage fallback would have been silently empty every time.
  let homepageUrl: string | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ig } = await (admin as any)
      .from('integrations').select('wordpress_url').eq('user_id', opts.userId).maybeSingle()
    homepageUrl = (ig?.wordpress_url as string | null) || null
  } catch { homepageUrl = null }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: page } = await (admin as any)
      .from('link_pages').select('id, handle, published').eq('user_id', opts.userId).maybeSingle()
    if (page?.handle && page.published) {
      shopHandle = page.handle as string
      // Put the product on the page before pinning at it. Upsert by ASIN so a
      // re-pin re-surfaces the existing tile instead of duplicating it.
      if (opts.asin) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existing } = await (admin as any)
          .from('link_page_items').select('id').eq('page_id', page.id).eq('asin', opts.asin).maybeSingle()
        if (existing?.id) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any).from('link_page_items')
            .update({ hidden: false, url: opts.affiliateUrl }).eq('id', existing.id)
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: last } = await (admin as any).from('link_page_items')
            .select('position').eq('page_id', page.id).order('position', { ascending: false }).limit(1).maybeSingle()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any).from('link_page_items').insert({
            page_id: page.id, user_id: opts.userId, kind: 'product',
            title: (opts.productTitle || 'Shop this').slice(0, 200),
            url: opts.affiliateUrl, image_url: opts.imageUrl || null,
            asin: opts.asin || null, source: 'pinterest',
            position: (typeof last?.position === 'number' ? last.position : -1) + 1,
            hidden: false,
          })
        }
      }
    }
  } catch (e) {
    // A shop page we could not read is the same as not having one: we fall
    // through to the homepage rather than pinning at an affiliate link.
    console.warn('[pin-destination] shop page lookup failed:', e instanceof Error ? e.message : e)
    shopHandle = null
  }

  return pinDestination({
    shopHandle,
    homepageUrl,
    appOrigin: process.env.NEXT_PUBLIC_APP_URL || 'https://www.mvpaffiliate.io',
  })
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
  /** A hosted image URL. Provide this OR imageBase64. */
  imageUrl?: string
  /** Base64 image bytes (no data: prefix) + its media type. Lets a caller publish
   *  a freshly-generated pin without hosting it first (e.g. the deal-pin path). */
  imageBase64?: string
  imageMediaType?: string
  asin?: string
  productUrl?: string
  productTitle?: string
  boardId?: string
  title?: string
  description?: string
  /** When set (Passport Links on), pin THIS link directly, skipping tag/geni.us
   *  resolution — the geo-routing link. */
  linkOverride?: string | null
}): Promise<PublishPinResult> {
  const { intRow } = opts
  if (!intRow.pinterest_access_token) throw new Error('Pinterest is not connected.')
  if (!opts.imageUrl && !opts.imageBase64) throw new Error('No image to pin.')

  // Resolve ASIN + affiliate link. A linkOverride (Passport Links) wins directly;
  // otherwise resolve the geni.us / tagged link, routed to the MVP-PINTEREST group.
  const resolved = (opts.linkOverride && /^https?:\/\//i.test(opts.linkOverride))
    ? { linkUrl: opts.linkOverride, asin: (opts.asin || '').trim().toUpperCase(), note: null }
    : await resolveAffiliateLink({
        userId: opts.userId, intRow, asin: opts.asin, productUrl: opts.productUrl, productTitle: opts.productTitle, channel: 'pinterest',
      })
  const { linkUrl: affiliateUrl, asin, note: geniuslinkNote } = resolved
  if (!affiliateUrl) throw new Error('No product link to pin to. Paste an Amazon link or ASIN.')

  // ── WHERE THE PIN IS ALLOWED TO POINT ─────────────────────────────────────
  //
  // Not at the affiliate link. Pinterest rejects affiliate redirect and cloaking
  // domains as a class — a real Deal Radar push came back with "we blocked this
  // link because it may lead to spam" on Pinterest alone while every other
  // platform in the same run posted fine — and MVP already knew this: the video
  // pin path carries the rule "NEVER an affiliate redirect, Pinterest + Amazon
  // ToS; every option here is the creator's own page". This path was written
  // separately and did the opposite.
  //
  // So the pin points at a page the creator owns, and the affiliate link sits on
  // that page. For a deal push, no blog post exists and never will, but the
  // shop page does: every Amazon social publish already drops the product onto
  // it as a tile with the affiliate link on it, which is why the same modal
  // tells the creator to point their bio there.
  //
  // The tile is written BEFORE the pin goes out, so a pin can never advertise a
  // product that is not on the page it lands on.
  const dest = await resolvePinDestinationFor({
    userId: opts.userId, intRow,
    asin, productTitle: opts.productTitle, imageUrl: opts.imageUrl,
    affiliateUrl,
  })
  if (!dest.url) throw new Error(dest.note || 'Pinterest needs a page of your own to link to.')
  const linkUrl = dest.url
  // Belt and braces. Whatever assembled this, an affiliate redirect must not be
  // what Pinterest sees, because the failure is not a rejected request: it is a
  // creator being told their content looks like spam.
  if (isBlockedPinLink(linkUrl)) throw new Error('Pinterest does not accept affiliate redirect links. This pin was not published.')

  // Copy — use what the caller passed, else auto-write.
  let title = (opts.title || '').trim()
  let description = (opts.description || '').trim()
  if (!title || !description) {
    const written = await writePinCopy({ userId: opts.userId, tier: opts.tier, productTitle: opts.productTitle, productUrl: opts.productUrl, asin })
    if (!title) title = written.title
    if (!description) description = written.description
  }

  // Compliance: every published pin carries the disclosure + #ad #sponsored,
  // even if the creator edited the box or a scheduled row stored older copy.
  description = finalizeSocialCaption(description)

  // Publish.
  const pinterest = new PinterestService(intRow.pinterest_access_token)
  // Explicit board pick (board picker) wins; else the legacy stored id; else a
  // default board we create on demand.
  const boardId = (opts.boardId || intRow.pinterest_pin_target || intRow.pinterest_board_id || '').trim()
    || (await pinterest.findOrCreateBoard('Reviews')).id
  // Resilient: the stored pinterest_board_id can be a stale sandbox board (frozen
  // at connect time during Pinterest trial access). On the sandbox error this
  // retries once on a fresh real board and heals the stored id.
  const pin = opts.imageBase64
    ? await pinterest.createPinWithBase64Resilient({ boardId, title, description, imageBase64: opts.imageBase64, mediaType: opts.imageMediaType || 'image/jpeg', link: linkUrl })
    : await pinterest.createPinResilient({ boardId, title, description, imageUrl: opts.imageUrl!, link: linkUrl })
  const healUserId = intRow.user_id || opts.userId
  if (pin.recovered && healUserId) {
    try {
      // Move a sandbox pin_target onto the recovered board too, so the failed
      // create+recover doesn't repeat on every publish.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const heal: any = { pinterest_board_id: pin.boardId, pinterest_board_name: PinterestService.RECOVERY_BOARD }
      // Only heal pinterest_pin_target when IT was the board that actually failed
      // — i.e. no explicit opts.boardId override took precedence in resolution.
      // Otherwise a per-post/scheduled boardId failing would wrongly overwrite a
      // still-good saved default.
      if (!(opts.boardId || '').trim() && (intRow.pinterest_pin_target || '').trim()) heal.pinterest_pin_target = pin.boardId
      const { createAdminClient } = await import('@/lib/supabase/admin')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (createAdminClient() as any).from('integrations').update(heal).eq('user_id', healUserId)
    } catch { /* best-effort heal — pin already published */ }
  }
  const pinId = pin.id
  return {
    pinId, pinUrl: `https://www.pinterest.com/pin/${pinId}/`, title, description,
    // What the PIN points at (the creator's page) and what that page sends the
    // shopper to (their affiliate link). Reporting only one of them is how this
    // became invisible in the first place.
    linkUrl, affiliateUrl, destinationKind: dest.kind,
    geniuslinkNote: geniuslinkNote || dest.note,
  }
}
