/**
 * POST /api/deal-radar/social-post — Deal Radar "Quick post".
 *
 * Publish ONE deal straight to the link-friendly socials (X, Facebook, Threads,
 * LinkedIn, Telegram, Bluesky) with a thumbnail, a price-safe caption, and the
 * creator's own affiliate link. Skips the blog for time-sensitive deals. NOT
 * Instagram/TikTok (no clickable caption link) or Pinterest (pins go to blog).
 *
 * Body: { asin, platforms: string[], caption? }
 * Returns: { ok, results: [{ platform, ok, url?, error? }] }
 *
 * Gate: Pro (+ admin), Labs while testing (NEXT_PUBLIC_DEAL_RADAR_ENABLED).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { canUseDealRadar } from '@/lib/feature-access'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { scrubBanned } from '@/lib/scrub'
import { AFFILIATE_DISCLAIMER_DEFAULT } from '@/lib/social-disclaimer'
import { publishDealToSocials, QUICK_POST_PLATFORMS, type QuickPostPlatform } from '@/lib/deal-social-publish'
import { createGeniuslinkService } from '@/services/geniuslink'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations')
      .select('tier,amazon_associates_tag,geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id).maybeSingle()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (!canUseDealRadar(tier)) {
      return NextResponse.json({ error: 'Amazon Deal Radar is available on paid plans.', currentTier: tier }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as { asin?: string; platforms?: unknown; caption?: string; title?: string; imageUrl?: string }
    const asin = (body.asin || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'A valid ASIN is required.' }, { status: 400 })
    const platforms = (Array.isArray(body.platforms) ? body.platforms : [])
      .map((p) => String(p)) .filter((p): p is QuickPostPlatform => QUICK_POST_PLATFORMS.includes(p as QuickPostPlatform))
    if (!platforms.length) return NextResponse.json({ error: 'Pick at least one platform.' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    let { data: deal } = await sb.from('deal_radar_cache')
      .select('asin,title,brand,image_url,discount_pct,deal_quality,lowest_label')
      .eq('asin', asin).maybeSingle()
    // Fallback: a watched product re-shared from the Price Alerts box may have
    // rotated out of the live cache. If the caller supplied the title/image
    // (they always do from the shared modal), post from that instead of 404ing.
    if (!deal) {
      const fbTitle = (body.title || '').trim()
      if (!fbTitle) return NextResponse.json({ error: 'That deal is no longer on the radar.' }, { status: 404 })
      deal = { asin, title: fbTitle, brand: null, image_url: body.imageUrl || null, discount_pct: null, deal_quality: null, lowest_label: null }
    }

    const tag = ((intRow as { amazon_associates_tag?: string | null } | null)?.amazon_associates_tag || '').trim()
    if (!tag) return NextResponse.json({ error: 'Add your Amazon Associates tag in Settings first, so your links earn.' }, { status: 400 })
    const link = `https://www.amazon.com/dp/${asin}?tag=${encodeURIComponent(tag)}`

    // When Geniuslink is connected, wrap the tagged link once per platform into
    // that platform's OWN tracking group (FACEBOOK, TWITTER, …) so the user can
    // see which channel drove clicks in their Geniuslink dashboard. Best-effort:
    // any platform we can't wrap keeps the bare tagged link. The affiliate tag
    // rides through Geniuslink's redirect either way, so links always earn.
    const gKey = ((intRow as { geniuslink_api_key?: string | null } | null)?.geniuslink_api_key || '').trim()
    const gSecret = ((intRow as { geniuslink_api_secret?: string | null } | null)?.geniuslink_api_secret || '').trim()
    const { links, note: geniuslinkNote } = await buildPlatformGeniuslinks(gKey, gSecret, link, deal.title as string, platforms)

    const { data: brand } = await sb.from('brand_profiles')
      .select('affiliate_disclaimer').eq('user_id', user.id).maybeSingle()
    const disclaimer = (brand?.affiliate_disclaimer as string | null)?.trim() || AFFILIATE_DISCLAIMER_DEFAULT

    // Base caption: user override, else a price-safe AI caption (no baked price
    // — the post is evergreen and a dollar amount would go stale + break Amazon's
    // price-display rule).
    let baseCaption = (body.caption || '').trim()
    if (!baseCaption) {
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
      baseCaption = ((msg.content[0] as { type: string; text: string }).text || '').trim()
      recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'deal_social_caption', model: 'claude-haiku-4-5-20251001' })
    }
    baseCaption = scrubBanned(baseCaption).slice(0, 600)
    if (!baseCaption) return NextResponse.json({ error: 'Could not build a caption — try again or write your own.' }, { status: 500 })

    const results = await publishDealToSocials({
      supabase, userId: user.id,
      deal: { asin, title: deal.title as string, imageUrl: (deal.image_url as string | null) || null },
      link, links, baseCaption, disclaimer, platforms,
    })

    const anyOk = results.some((r) => r.ok)
    return NextResponse.json({ ok: anyOk, results, caption: baseCaption, geniuslinkNote }, { status: anyOk ? 200 : 502 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[deal-radar/social-post]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * For each selected platform, wrap the tagged Amazon URL into a Geniuslink short
 * URL routed to a group named after the platform (FACEBOOK, TWITTER, THREADS, …),
 * creating the group on first use. Returns a partial map platform → short URL;
 * platforms we can't wrap are simply absent (caller falls back to the bare tagged
 * link). Reuses ONE list-groups round-trip for the whole batch.
 *
 * Best-effort throughout: no Geniuslink creds, a list-groups failure, or a
 * per-platform error just means that platform keeps the tagged link — the tag
 * still earns, so a post never goes out unattributed.
 */
async function buildPlatformGeniuslinks(
  gKey: string,
  gSecret: string,
  destination: string,
  title: string,
  platforms: QuickPostPlatform[],
): Promise<{ links: Partial<Record<QuickPostPlatform, string>>; note: string | null }> {
  const out: Partial<Record<QuickPostPlatform, string>> = {}
  // First Geniuslink error we hit — surfaced to the client so a fallback to the
  // bare tagged link is visible ("why isn't my link a geni.us link?") instead of
  // silent. null when Geniuslink isn't connected or everything shortened fine.
  let note: string | null = null
  const capture = (msg: string) => { if (!note) note = msg }
  if (!gKey || !gSecret) return { links: out, note }
  const svc = createGeniuslinkService(gKey, gSecret)

  // One list-groups call, then find-or-create each platform group off the map.
  // If listing groups fails we DON'T give up on shortening — we proceed with an
  // empty map, so each platform still tries to create a link (in its default
  // group as a last resort). Only a hard createLink failure drops to the tagged
  // link.
  let groupsByName = new Map<string, number>()
  try {
    const groups = await svc.listGroups()
    groupsByName = new Map(groups.map((g) => [String(g.Name || '').trim().toLowerCase(), g.Id]))
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err)
    console.warn('[deal-radar/social-post] geniuslink listGroups failed — will still try default-group links:', m)
    capture(`Geniuslink: ${m}`)
  }

  for (const p of platforms) {
    const name = p.toUpperCase() // 'facebook' → 'FACEBOOK', 'twitter' → 'TWITTER'
    try {
      let groupId = groupsByName.get(name.toLowerCase()) ?? null
      if (!groupId) {
        try {
          groupId = await svc.createGroup(name)
          if (groupId) groupsByName.set(name.toLowerCase(), groupId)
        } catch (gErr) {
          console.warn(`[deal-radar/social-post] geniuslink createGroup(${name}) failed — using default group:`, gErr instanceof Error ? gErr.message : gErr)
        }
      }
      const label = `${title} — ${name}`.slice(0, 120)
      // Grouped link first; if that specific call fails (e.g. a just-created
      // group id not yet usable), retry WITHOUT a group so we still return a
      // geni.us short link rather than a bare Amazon URL.
      let url: string
      try {
        url = await svc.createLink(destination, label, groupId ? { groupId, note: `Deal Radar | ${name}` } : {})
      } catch (linkErr) {
        console.warn(`[deal-radar/social-post] geniuslink grouped createLink for ${p} failed — retrying in default group:`, linkErr instanceof Error ? linkErr.message : linkErr)
        url = await svc.createLink(destination, label, {})
      }
      if (url && /^https?:\/\//i.test(url)) out[p] = url
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      console.warn(`[deal-radar/social-post] geniuslink wrap failed for ${p} — using tagged link:`, m)
      capture(`Geniuslink: ${m}`)
    }
  }
  return { links: out, note }
}
