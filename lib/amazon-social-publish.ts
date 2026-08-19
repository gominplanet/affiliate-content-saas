// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Instagram + Facebook publish for the Amazon Influencer → Social Influencer
// flow. Mirrors lib/amazon-pin-publish (shared resolveAffiliateLink +
// finalizeSocialCaption): one Art Director design → AI caption → affiliate link
// → publish. FB puts the geni.us link inline; IG can't carry a caption link, so
// it appends "link in bio" and (best-effort) drops a product tile in the shop
// grid the bio points at.
import { publishMedia } from '@/services/instagram'
import { createFacebookService } from '@/services/facebook'
import { resolveAffiliateLink, finalizeSocialCaption, type PinIntegration } from '@/lib/amazon-pin-publish'
import { fetchAmazonProduct } from '@/services/amazon'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { scrubBanned } from '@/lib/scrub'
import type { Tier } from '@/lib/tier'

export interface SocialIntegration extends PinIntegration {
  instagram_user_id?: string | null
  instagram_access_token?: string | null
  instagram_username?: string | null
  facebook_page_id?: string | null
  facebook_page_access_token?: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * Write a single social caption (Instagram / Facebook): benefit-led body +
 * niche discovery hashtags, with the FTC disclosure + #ad #sponsored guaranteed
 * by finalizeSocialCaption. No link — the caller adds the geni.us link (FB) or a
 * "link in bio" line (IG).
 */
export async function writeSocialCaption(opts: {
  userId: string
  tier: Tier
  productTitle?: string
  productUrl?: string
  asin?: string
}): Promise<string> {
  const asin = (opts.asin || '').trim().toUpperCase()
  let productTitle = (opts.productTitle || '').trim()
  if (!productTitle && asin) {
    try { productTitle = (await fetchAmazonProduct(asin)).title || '' } catch { /* ignore */ }
  }
  let body = ''
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: 'You write high-CTR social captions for product finds (Instagram/Facebook). Return STRICT JSON {"caption"}. caption ≤ 350 chars, benefit-led and scroll-stopping, then 4–6 relevant NICHE hashtags for discovery (specific to the product category). No price claims, no "cheap", no fake urgency. No markdown, JSON only.',
      messages: [{ role: 'user', content: `PRODUCT: ${productTitle || opts.productUrl || 'a great find'}\n\nWrite the caption JSON now.` }],
    })
    recordAnthropicUsage(msg, { userId: opts.userId, tier: opts.tier, feature: 'amazon_social_caption', model: 'claude-haiku-4-5-20251001' })
    const raw = (msg.content[0] as { type: string; text?: string }).text || ''
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { caption?: string }
    body = scrubBanned(String(j.caption || '').trim())
  } catch { /* fall back */ }
  if (!body) body = productTitle || 'A great find'
  return finalizeSocialCaption(body)
}

/** Drop the just-posted product into the creator's Link-in-Bio shop grid and
 *  mark it live "in my story", so followers who see the IG post can tap link-in-
 *  bio and shop it. Re-marks an existing tile instead of duplicating. Best-effort
 *  — skips silently if they have no shop page. `inStory` controls the toggle. */
async function syncLinkInBioTile(db: Db, userId: string, item: { asin: string; title: string; imageUrl?: string; url: string }, inStory: boolean): Promise<void> {
  try {
    const { data: page } = await db.from('link_pages').select('id').eq('user_id', userId).maybeSingle()
    if (!page?.id) return
    if (item.asin) {
      const { data: existing } = await db.from('link_page_items').select('id').eq('page_id', page.id).eq('asin', item.asin).maybeSingle()
      if (existing?.id) {
        await db.from('link_page_items').update({ in_story: inStory, hidden: false }).eq('id', existing.id).eq('user_id', userId)
        return
      }
    }
    const { data: last } = await db.from('link_page_items').select('position').eq('page_id', page.id).order('position', { ascending: false }).limit(1).maybeSingle()
    const position = (typeof last?.position === 'number' ? last.position : -1) + 1
    await db.from('link_page_items').insert({
      page_id: page.id, user_id: userId, kind: 'product',
      title: item.title.slice(0, 200), url: item.url, image_url: item.imageUrl || null,
      asin: item.asin || null, source: 'amazon-social', position, hidden: false, in_story: inStory,
    })
  } catch { /* best-effort */ }
}

// Facebook caption order (Seb's preference): affiliate link + disclosure FIRST,
// then the body. Strips any disclosure / #ad / #sponsored / link already in the
// body so they aren't duplicated, keeping the niche hashtags.
function facebookCaptionOrder(rawBody: string, linkUrl: string): string {
  let b = (rawBody || '')
    .replace(/as an amazon associate i earn from qualifying purchases\.?/ig, '')
    .replace(/(^|\s)#ad\b/ig, ' ')
    .replace(/(^|\s)#sponsored\b/ig, ' ')
  if (linkUrl) b = b.split(linkUrl).join('')
  b = b.replace(/🛒/g, '').replace(/[^\S\r\n]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  const header = [
    linkUrl ? `🛒 ${linkUrl}` : '',
    'As an Amazon Associate I earn from qualifying purchases. #ad #sponsored',
  ].filter(Boolean).join('\n')
  return `${header}\n\n${b}`.trim()
}

export async function publishToFacebook(opts: {
  userId: string
  tier: Tier
  intRow: SocialIntegration
  imageUrl: string
  asin?: string
  productUrl?: string
  productTitle?: string
  caption?: string
}): Promise<{ id: string; url: string; caption: string; linkUrl: string; note: string | null }> {
  const { intRow } = opts
  if (!intRow.facebook_page_id || !intRow.facebook_page_access_token) throw new Error('Facebook Page is not connected.')

  const { linkUrl, asin, note } = await resolveAffiliateLink({
    userId: opts.userId, intRow, asin: opts.asin, productUrl: opts.productUrl, productTitle: opts.productTitle, channel: 'facebook',
  })

  const body = (opts.caption || '').trim() || await writeSocialCaption({ userId: opts.userId, tier: opts.tier, productTitle: opts.productTitle, productUrl: opts.productUrl, asin })
  // Facebook: lead with the affiliate link + disclosure, then the rest.
  const caption = facebookCaptionOrder(body, linkUrl)

  const fb = createFacebookService(intRow.facebook_page_access_token, intRow.facebook_page_id)
  const res = await fb.postPhoto({ imageUrl: opts.imageUrl, caption })
  const postId = res.post_id || res.id
  return { id: postId, url: `https://www.facebook.com/${postId}`, caption, linkUrl, note }
}

export async function publishToInstagram(opts: {
  db: Db
  userId: string
  tier: Tier
  intRow: SocialIntegration
  imageUrl: string
  asin?: string
  productUrl?: string
  productTitle?: string
  caption?: string
  /** 'feed' (default) → a 4:5 feed post with a caption. 'story' → a 9:16 story
   *  (IG ignores its caption/link, so the shop happens purely via Link-in-Bio). */
  postType?: 'feed' | 'story'
}): Promise<{ id: string; url: string; caption: string; linkUrl: string; note: string | null }> {
  const { intRow } = opts
  if (!intRow.instagram_user_id || !intRow.instagram_access_token) throw new Error('Instagram is not connected.')
  const isStory = opts.postType === 'story'

  const { linkUrl, asin, note } = await resolveAffiliateLink({
    userId: opts.userId, intRow, asin: opts.asin, productUrl: opts.productUrl, productTitle: opts.productTitle, channel: 'instagram',
  })

  let caption = (opts.caption || '').trim() || await writeSocialCaption({ userId: opts.userId, tier: opts.tier, productTitle: opts.productTitle, productUrl: opts.productUrl, asin })
  caption = finalizeSocialCaption(caption)
  // IG can't put a clickable link in the caption — route through Link-in-Bio.
  if (!/link in bio/i.test(caption)) caption = `${caption}\n\n🔗 Link in bio to shop`

  // The whole point: the posted product lands in the bio shop grid. A Story
  // marks it live in the "in my story" section so followers can tap link-in-bio
  // and buy it; a feed post just adds the shoppable tile. Use the REAL product
  // name + clean product photo for the tile (not the busy story graphic).
  if (linkUrl) {
    let tileTitle = (opts.productTitle || '').trim()
    let tileImage: string | undefined = undefined
    if (asin) {
      try {
        const p = await fetchAmazonProduct(asin)
        if (!tileTitle) tileTitle = p.title || ''
        tileImage = p.imageUrl || undefined
      } catch { /* best-effort */ }
    }
    await syncLinkInBioTile(opts.db, opts.userId, { asin, title: tileTitle || 'Shop this', imageUrl: tileImage || opts.imageUrl, url: linkUrl }, isStory)
  }

  const mediaId = await publishMedia({
    userId: intRow.instagram_user_id, accessToken: intRow.instagram_access_token,
    mediaType: isStory ? 'STORIES' : 'IMAGE', imageUrl: opts.imageUrl, caption: isStory ? undefined : caption,
  })
  return { id: mediaId, url: isStory ? `https://www.instagram.com/${intRow.instagram_username || ''}` : `https://www.instagram.com/p/${mediaId}/`, caption, linkUrl, note }
}
