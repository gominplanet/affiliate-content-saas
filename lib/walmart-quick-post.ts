// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Walmart "Quick post to socials" core — the Walmart twin of lib/deal-quick-post.
// Given a Walmart item, it mints the commissionable link (get_products_link →
// goto.walmart.com/Impact), wraps it per-platform via Geniuslink when connected,
// writes a price-safe caption, and fires the post through the shared
// publishDealToSocials orchestrator (retailerLabel = "Walmart").

import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { scrubBanned } from '@/lib/scrub'
import { AFFILIATE_DISCLAIMER_DEFAULT } from '@/lib/social-disclaimer'
import { publishDealToSocials, QUICK_POST_PLATFORMS, type QuickPostPlatform } from '@/lib/deal-social-publish'
import { buildDealCardImage } from '@/lib/deal-card'
import { buildPlatformGeniuslinks } from '@/lib/deal-quick-post'
import { getWalmartProductLinks } from '@/services/partnerboost'
import type { Tier } from '@/lib/tier'

export interface WalmartQuickPostInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
  userId: string
  tier: Tier
  intRow: { geniuslink_api_key?: string | null; geniuslink_api_secret?: string | null } | null
  pbToken: string
  itemId: string
  name: string
  imageUrl?: string | null
  /** Bare product URL, used only if minting a tracking link fails. */
  fallbackUrl?: string | null
  platforms: QuickPostPlatform[]
  caption?: string
}

export interface WalmartQuickPostOutput {
  results: Array<{ platform: string; ok: boolean; url?: string; error?: string }>
  caption: string | null
  geniuslinkNote: string | null
  /** No commissionable link could be minted and no fallback was given. */
  missingLink?: boolean
}

export async function executeWalmartQuickPost(input: WalmartQuickPostInput): Promise<WalmartQuickPostOutput> {
  const { db, userId, tier, intRow, pbToken, name, imageUrl } = input
  const itemId = (input.itemId || '').trim()
  const platforms = input.platforms.filter((p) => QUICK_POST_PLATFORMS.includes(p))
  if (!platforms.length) return { results: [], caption: null, geniuslinkNote: null }

  // Mint the attributed Walmart link (bare URL earns nothing).
  let link = ''
  try {
    const links = await getWalmartProductLinks(pbToken, [itemId])
    if (links[itemId]) link = links[itemId]
  } catch { /* fall back below */ }
  if (!link) link = (input.fallbackUrl || '').trim()
  if (!link) return { results: [], caption: null, geniuslinkNote: null, missingLink: true }

  // Per-platform Geniuslink wrap (best-effort; keeps the minted link otherwise).
  const gKey = (intRow?.geniuslink_api_key || '').trim()
  const gSecret = (intRow?.geniuslink_api_secret || '').trim()
  let built: { links: Partial<Record<QuickPostPlatform, string>>; note: string | null } = { links: {}, note: null }
  try {
    built = await buildPlatformGeniuslinks(gKey, gSecret, link, name, platforms)
  } catch (err) {
    console.warn('[walmart-quick-post] geniuslink step failed — using the minted link:', err instanceof Error ? err.message : err)
  }

  const { data: brand } = await db.from('brand_profiles').select('affiliate_disclaimer,name,logo_url').eq('user_id', userId).maybeSingle()
  const disclaimer = (brand?.affiliate_disclaimer as string | null)?.trim() || AFFILIATE_DISCLAIMER_DEFAULT

  let cap = (input.caption || '').trim()
  if (!cap) {
    try {
      const anthropic = createAnthropicClient()
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 220,
        messages: [{ role: 'user', content: `Write a punchy social caption for this Walmart deal.

Product: ${name}

Rules:
- 1-2 short sentences. A strong hook + why it's worth grabbing now.
- Say it's on sale / a great price RIGHT NOW. Do NOT state any specific price or "was" price, and do NOT invent a percentage — the number changes and the post lives forever.
- Do NOT include a link or the word "link" — we append the link ourselves.
- At most ONE hashtag, only if natural. Plain text, no markdown.
- Never claim you personally tested or own the product.

Return ONLY the caption text.` }],
      })
      cap = ((msg.content[0] as { type: string; text: string }).text || '').trim()
      recordAnthropicUsage(msg, { userId, tier, feature: 'walmart_social_caption', model: 'claude-haiku-4-5-20251001' })
    } catch (err) {
      console.warn('[walmart-quick-post] caption generation failed — using a simple fallback:', err instanceof Error ? err.message : err)
    }
  }
  cap = scrubBanned(cap).slice(0, 600)
  if (!cap) cap = name.slice(0, 200)

  // Designed deal card (best-effort → falls back to the raw product photo).
  const postImage = (await buildDealCardImage(imageUrl || null, {
    brandName: (brand?.name as string | null),
    logoUrl: brand?.logo_url as string | null,
  })) || imageUrl || null

  const results = await publishDealToSocials({
    supabase: db, userId,
    deal: { asin: itemId, title: name, imageUrl: postImage },
    link, links: built.links, baseCaption: cap, disclaimer, platforms,
    retailerLabel: 'Walmart',
  })

  return { results, caption: cap, geniuslinkNote: built.note }
}
