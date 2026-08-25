// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared core for Deal Radar "Quick post to socials", used by BOTH the immediate
// POST route and the scheduled-post cron. Given an ASIN + platforms (+ optional
// caption / story), it resolves the deal, the creator's affiliate link (wrapped
// per-platform via Geniuslink when connected), a price-safe caption, and fires
// the post. Extracted so scheduling reuses the exact same publish path instead
// of a divergent copy.

import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { scrubBanned } from '@/lib/scrub'
import { AFFILIATE_DISCLAIMER_DEFAULT } from '@/lib/social-disclaimer'
import { publishDealToSocials, QUICK_POST_PLATFORMS, type QuickPostPlatform, type PlatformResult } from '@/lib/deal-social-publish'
import { publishDealStory } from '@/lib/deal-story-publish'
import { buildDealCardImage } from '@/lib/deal-card'
import { createGeniuslinkService } from '@/services/geniuslink'
import { resolveCloakedLink, getLinkStyle } from '@/lib/link-cloak'
import { CHANNEL_GROUP_NAMES, channelKey } from '@/lib/geniuslink-group'
import type { Tier } from '@/lib/tier'

export interface DealQuickPostInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any                 // a Supabase client — the user's server client OR the admin client
  userId: string
  tier: Tier
  intRow: {
    user_id?: string | null
    amazon_associates_tag?: string | null
    geniuslink_api_key?: string | null
    geniuslink_api_secret?: string | null
    // Pinterest publish (only needed when `pinterest` is set).
    pinterest_access_token?: string | null
    pinterest_board_id?: string | null
    pinterest_pin_target?: string | null
  } | null
  asin: string
  platforms: QuickPostPlatform[]
  /** Pinterest is a separate pipeline (designed pin → affiliate link), not one of
   *  the caption-link QuickPostPlatforms. When true, also publish a deal pin. */
  pinterest?: boolean
  story: boolean
  caption?: string        // user override; blank ⇒ we auto-write a price-safe caption
  title?: string | null   // fallback title when the ASIN has rotated out of the live cache
  imageUrl?: string | null
  // When true (scheduled posts), REFUSE to post if the deal is no longer live on
  // the radar — a scheduled deal that has since ended must not go out. The
  // immediate path keeps false so a re-share from Price Alerts still works.
  requireLiveDeal?: boolean
}

export interface DealQuickPostOutput {
  results: Array<{ platform: string; ok: boolean; url?: string; error?: string }>
  caption: string | null
  geniuslinkNote: string | null
  // Set only when requireLiveDeal blocked the whole post because the deal ended.
  dealEnded?: boolean
  // Set when the caller didn't supply a tag (nothing was posted).
  missingTag?: boolean
}

/**
 * Run a Deal Radar quick post. Errors on individual platforms are captured per
 * platform (never thrown); only setup problems (missing tag, ended deal when
 * requireLiveDeal) short-circuit with a flag so the caller can message it.
 */
export async function executeDealQuickPost(input: DealQuickPostInput): Promise<DealQuickPostOutput> {
  const { db, userId, tier, intRow, platforms, story: wantStory, requireLiveDeal } = input
  const asin = (input.asin || '').trim().toUpperCase()

  let { data: deal } = await db.from('deal_radar_cache')
    .select('asin,title,brand,image_url,discount_pct,deal_quality,lowest_label')
    .eq('asin', asin).maybeSingle()

  if (!deal) {
    // Scheduled posts: an ASIN that has dropped out of the radar means the deal
    // is over. Do NOT post a stale deal — that's the whole caveat behind
    // scheduling deals. Immediate re-shares fall back to the supplied title.
    if (requireLiveDeal) {
      return { results: [], caption: null, geniuslinkNote: null, dealEnded: true }
    }
    const fbTitle = (input.title || '').trim()
    if (!fbTitle) return { results: [], caption: null, geniuslinkNote: null, dealEnded: true }
    deal = { asin, title: fbTitle, brand: null, image_url: input.imageUrl || null, discount_pct: null, deal_quality: null, lowest_label: null }
  }
  const dealImage = (deal.image_url as string | null) || null

  const results: Array<{ platform: string; ok: boolean; url?: string; error?: string }> = []
  let baseCaption: string | null = null
  let geniuslinkNote: string | null = null

  const dealTitle = (deal.title as string) || null
  const tag = (intRow?.amazon_associates_tag || '').trim()
  // The creator's Link style, resolved ONCE, then applied per channel through the
  // single resolver — Passport / Geniuslink / Bitly / Direct all cloak the same
  // way. One link per platform so each channel's clicks attribute to its own group.
  const linkStyle = await getLinkStyle(db, userId)
  const taggedLink = `https://www.amazon.com/dp/${asin}${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`
  const platformLinks: Partial<Record<QuickPostPlatform, string>> = {}
  if (platforms.length) {
    await Promise.all(platforms.map(async (p) => {
      platformLinks[p] = await resolveCloakedLink({ supabase: db, userId, destination: taggedLink, asin, channel: p, source: p, label: dealTitle, config: linkStyle })
    }))
  }
  // Pinterest is a separate pipeline — its own cloaked link (MVP-PINTEREST group).
  const pinLink = input.pinterest
    ? await resolveCloakedLink({ supabase: db, userId, destination: taggedLink, asin, channel: 'pinterest', source: 'pinterest', label: dealTitle, config: linkStyle })
    : null

  // ── Link-friendly text platforms ──
  if (platforms.length) {
    // Passport builds its own per-country tags; every other style needs the US tag.
    if (!tag && linkStyle.style !== 'passport') return { results: [], caption: null, geniuslinkNote: null, missingTag: true }
    const link = platformLinks[platforms[0]] || taggedLink

    const { data: brand } = await db.from('brand_profiles')
      .select('affiliate_disclaimer,name,logo_url').eq('user_id', userId).maybeSingle()
    const disclaimer = (brand?.affiliate_disclaimer as string | null)?.trim() || AFFILIATE_DISCLAIMER_DEFAULT

    let cap = (input.caption || '').trim()
    if (!cap) {
      try {
        const anthropic = createAnthropicClient()
        const msg = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 220,
          messages: [{ role: 'user', content: `Write a punchy social caption for this Amazon deal.

Product: ${deal.title}${deal.brand ? ` (${deal.brand})` : ''}
${deal.lowest_label ? `Price signal: ${deal.lowest_label}.` : ''}

Rules:
- 1-2 short sentences. A strong hook + why it's worth grabbing now.
- Say it's on sale / a great price RIGHT NOW. Do NOT state any specific price or "was" price, and do NOT invent a percentage — the number changes and the post lives forever.
- Do NOT include a link or the word "link" — we append the link ourselves.
- At most ONE hashtag, only if natural. Plain text, no markdown.
- Never claim you personally tested or own the product.

Return ONLY the caption text.` }],
        })
        cap = ((msg.content[0] as { type: string; text: string }).text || '').trim()
        recordAnthropicUsage(msg, { userId, tier, feature: 'deal_social_caption', model: 'claude-haiku-4-5-20251001' })
      } catch (capErr) {
        console.warn('[deal-quick-post] caption generation failed — using a simple fallback:', capErr instanceof Error ? capErr.message : capErr)
      }
    }
    cap = scrubBanned(cap).slice(0, 600)
    if (!cap) cap = (deal.title as string).slice(0, 200)
    baseCaption = cap

    // Turn the bare product photo into a designed deal card (product + a bold
    // qualitative hook + brand chip). Best-effort — falls back to the raw photo.
    const postImage = (await buildDealCardImage(dealImage, {
      dealQuality: deal.deal_quality as string | null,
      lowestLabel: deal.lowest_label as string | null,
      discountPct: deal.discount_pct as number | null,
      brandName: (brand?.name as string | null) ?? (deal.brand as string | null),
      logoUrl: brand?.logo_url as string | null,
    })) || dealImage

    const textResults: PlatformResult[] = await publishDealToSocials({
      supabase: db, userId,
      deal: { asin, title: deal.title as string, imageUrl: postImage },
      // Passport on → each platform's own MVP-<CHANNEL> geo link; off → the
      // per-platform Geniuslink map (or the shared tagged fallback via `link`).
      link, links: platformLinks, baseCaption: cap, disclaimer, platforms,
    })
    results.push(...textResults)
  }

  // ── Pinterest (designed pin → geni.us affiliate link) ──
  // Separate pipeline from the caption-link platforms above: reuses the
  // Amazon-Influencer pin path (design the pin, point it at the affiliate link,
  // FTC disclosure + board handled). A tag is what makes the pin earn, so require
  // one, matching the text-platform behaviour.
  if (input.pinterest) {
    const tag = (intRow?.amazon_associates_tag || '').trim()
    if (!tag && !results.length && !wantStory) {
      return { results: [], caption: baseCaption, geniuslinkNote, missingTag: true }
    }
    const { publishDealPin } = await import('@/lib/deal-pin')
    const pinRes = await publishDealPin({
      userId, tier, intRow: intRow ?? null,
      asin, title: deal.title as string, productImageUrl: dealImage,
      linkOverride: pinLink,
    })
    results.push({ platform: 'pinterest', ok: pinRes.ok, url: pinRes.url, error: pinRes.error })
    if (pinRes.note && !geniuslinkNote) geniuslinkNote = pinRes.note
  }

  // ── Instagram Story (baked-in "LINK IN BIO" CTA) ──
  if (wantStory) {
    const headline = deal.deal_quality === 'excellent' ? 'HOT DEAL' : 'ON SALE NOW'
    const s = await publishDealStory({
      supabase: db, userId,
      deal: { asin, title: deal.title as string, imageUrl: dealImage },
      headline,
    })
    results.push({ platform: 'instagram_story', ok: s.ok, url: s.ok ? 'https://www.instagram.com/' : undefined, error: s.error })
  }

  return { results, caption: baseCaption, geniuslinkNote }
}

/**
 * For each selected platform, wrap the tagged Amazon URL into a Geniuslink short
 * URL routed to a group named after the platform (FACEBOOK, TWITTER, …), creating
 * the group on first use. Best-effort throughout — anything we can't wrap keeps
 * the bare tagged link, which still earns.
 */
export async function buildPlatformGeniuslinks(
  gKey: string,
  gSecret: string,
  destination: string,
  title: string,
  platforms: QuickPostPlatform[],
): Promise<{ links: Partial<Record<QuickPostPlatform, string>>; note: string | null }> {
  const out: Partial<Record<QuickPostPlatform, string>> = {}
  let note: string | null = null
  const capture = (msg: string) => { if (!note) note = msg }
  if (!gKey || !gSecret) return { links: out, note }
  const svc = createGeniuslinkService(gKey, gSecret)

  let groupsByName = new Map<string, number>()
  try {
    const groups = await svc.listGroups()
    groupsByName = new Map(groups.map((g) => [String(g.Name || '').trim().toLowerCase(), g.Id]))
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err)
    console.warn('[deal-quick-post] geniuslink listGroups failed — will still try default-group links:', m)
    capture(`Geniuslink: ${m}`)
  }

  for (const p of platforms) {
    // Unified per-channel group name (MVP-FACEBOOK, …) so deal posts land in the
    // SAME buckets as the rest of MVP's per-channel attribution, not a separate
    // bare-named group.
    const name = CHANNEL_GROUP_NAMES[channelKey(p) || ''] || `MVP-${p.toUpperCase()}`.slice(0, 20)
    try {
      let groupId = groupsByName.get(name.toLowerCase()) ?? null
      if (!groupId) {
        try {
          groupId = await svc.createGroup(name)
          if (groupId) groupsByName.set(name.toLowerCase(), groupId)
        } catch (gErr) {
          console.warn(`[deal-quick-post] geniuslink createGroup(${name}) failed — using default group:`, gErr instanceof Error ? gErr.message : gErr)
        }
      }
      const label = `${title} — ${name}`.slice(0, 120)
      let url: string
      try {
        url = await svc.createLink(destination, label, groupId ? { groupId, note: `Deal Radar | ${name}` } : {})
      } catch (linkErr) {
        console.warn(`[deal-quick-post] geniuslink grouped createLink for ${p} failed — retrying in default group:`, linkErr instanceof Error ? linkErr.message : linkErr)
        url = await svc.createLink(destination, label, {})
      }
      if (url && /^https?:\/\//i.test(url)) out[p] = url
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      console.warn(`[deal-quick-post] geniuslink wrap failed for ${p} — using tagged link:`, m)
      capture(`Geniuslink: ${m}`)
    }
  }
  return { links: out, note }
}
