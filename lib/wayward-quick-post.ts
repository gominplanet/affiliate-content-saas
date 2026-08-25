// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Wayward "Quick post to socials" core — the Wayward twin of lib/walmart-quick-post.
// Given a Wayward product (ASIN), it mints the attributed Amazon link, wraps it
// per-platform via Geniuslink when connected, writes a price-safe caption, and
// fires the post through the shared publishDealToSocials orchestrator
// (retailerLabel = "Amazon").

import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { scrubBanned } from '@/lib/scrub'
import { AFFILIATE_DISCLAIMER_DEFAULT } from '@/lib/social-disclaimer'
import { publishDealToSocials, QUICK_POST_PLATFORMS, type QuickPostPlatform } from '@/lib/deal-social-publish'
import { buildDealCardImage } from '@/lib/deal-card'
import { buildPlatformGeniuslinks } from '@/lib/deal-quick-post'
import { getLinkStyle } from '@/lib/link-cloak'
import { shortenBitly } from '@/lib/bitly'
import { createWaywardLink } from '@/services/wayward'
import type { Tier } from '@/lib/tier'

export interface WaywardQuickPostInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
  userId: string
  tier: Tier
  intRow: { geniuslink_api_key?: string | null; geniuslink_api_secret?: string | null } | null
  waywardToken: string
  asin: string
  name: string
  imageUrl?: string | null
  platforms: QuickPostPlatform[]
  caption?: string
}

export interface WaywardQuickPostOutput {
  results: Array<{ platform: string; ok: boolean; url?: string; error?: string }>
  caption: string | null
  geniuslinkNote: string | null
  missingLink?: boolean
}

export async function executeWaywardQuickPost(input: WaywardQuickPostInput): Promise<WaywardQuickPostOutput> {
  const { db, userId, tier, intRow, waywardToken, name, imageUrl } = input
  const asin = (input.asin || '').trim()
  const platforms = input.platforms.filter((p) => QUICK_POST_PLATFORMS.includes(p))
  if (!platforms.length) return { results: [], caption: null, geniuslinkNote: null }

  // Mint the Wayward attributed Amazon link (a bare URL earns nothing).
  let link = ''
  try {
    const minted = await createWaywardLink(waywardToken, asin)
    link = minted.link
  } catch { /* no fallback — Wayward attribution is the whole point */ }
  if (!link) return { results: [], caption: null, geniuslinkNote: null, missingLink: true }

  // Cloak the Wayward link per the creator's ONE chosen Link style. Geniuslink →
  // per-platform groups; Bitly → shorten once; Direct → leave it. Passport is
  // deliberately skipped: a Passport geo-link would drop Wayward's own maas
  // attribution that is the whole point here. Best-effort.
  const cfg = await getLinkStyle(db, userId)
  let built: { links: Partial<Record<QuickPostPlatform, string>>; note: string | null } = { links: {}, note: null }
  if (cfg.style === 'geniuslink') {
    const gKey = (intRow?.geniuslink_api_key || '').trim()
    const gSecret = (intRow?.geniuslink_api_secret || '').trim()
    try {
      built = await buildPlatformGeniuslinks(gKey, gSecret, link, name, platforms)
    } catch (err) {
      console.warn('[wayward-quick-post] geniuslink step failed — using the Wayward link:', err instanceof Error ? err.message : err)
    }
  } else if (cfg.style === 'bitly' && cfg.bitlyToken) {
    try {
      const short = await shortenBitly(cfg.bitlyToken, link)
      if (short) link = short
    } catch (err) {
      console.warn('[wayward-quick-post] bitly step failed — using the Wayward link:', err instanceof Error ? err.message : err)
    }
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
        messages: [{ role: 'user', content: `Write a punchy social caption for this Amazon product.

Product: ${name}

Rules:
- 1-2 short sentences. A strong hook + why it's worth checking out.
- Do NOT state any specific price or "was" price, and do NOT invent a percentage — the number changes and the post lives forever.
- Do NOT include a link or the word "link" — we append the link ourselves.
- At most ONE hashtag, only if natural. Plain text, no markdown.
- Never claim you personally tested or own the product.

Return ONLY the caption text.` }],
      })
      cap = ((msg.content[0] as { type: string; text: string }).text || '').trim()
      recordAnthropicUsage(msg, { userId, tier, feature: 'wayward_social_caption', model: 'claude-haiku-4-5-20251001' })
    } catch (err) {
      console.warn('[wayward-quick-post] caption generation failed — using a simple fallback:', err instanceof Error ? err.message : err)
    }
  }
  cap = scrubBanned(cap).slice(0, 600)
  if (!cap) cap = name.slice(0, 200)

  // Designed product card — Wayward is a product share, not a discount, so the
  // hook is "TOP PICK", never "ON SALE". Best-effort → falls back to raw photo.
  const postImage = (await buildDealCardImage(imageUrl || null, {
    headline: 'TOP PICK',
    brandName: (brand?.name as string | null),
    logoUrl: brand?.logo_url as string | null,
  })) || imageUrl || null

  const results = await publishDealToSocials({
    supabase: db, userId,
    deal: { asin, title: name, imageUrl: postImage },
    link, links: built.links, baseCaption: cap, disclaimer, platforms,
    retailerLabel: 'Amazon',
  })

  return { results, caption: cap, geniuslinkNote: built.note }
}
