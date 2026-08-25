// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The ONE place MVP turns a destination into the creator's cloaked link. Every
// generation path (blog, social, deals, EPC, pins, YouTube, bio, …) should call
// resolveCloakedLink so a creator's chosen "Link style" is applied UNIVERSALLY
// and identically everywhere.
//
// Style is one per creator, resolved by getLinkStyle():
//   passport   — Passport Links ON (Amazon/Studio/Pro). Free, geo-routes Amazon.
//   geniuslink — their Geniuslink keys. Paid per click; geo-routes Amazon.
//   bitly      — their Bitly token. Free short link; NO geo-routing.
//   direct     — the plain tagged link, no cloaking.
// Passport ON always wins; otherwise blog_social_link_mode decides; a style whose
// credentials are missing falls back to direct so a link never fails to generate.

import { canUsePassport } from '@/lib/feature-access'
import { normalizeTier } from '@/lib/tier'
import { passportLinkForUser, getOrCreatePassportLink, passportLinkUrl } from '@/lib/passport-links'
import { channelWrapLink } from '@/lib/channel-share-url'
import { shortenBitly } from '@/lib/bitly'
import { getDefaultSite } from '@/lib/wordpress-sites'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type LinkStyle = 'passport' | 'geniuslink' | 'bitly' | 'direct'

export interface LinkStyleConfig {
  style: LinkStyle
  tier: string | null
  bitlyToken: string | null
  geniuslinkKey: string | null
  geniuslinkSecret: string | null
}

/**
 * Pure style decision (no I/O), so it's unit-testable and the single source of
 * truth for the priority rules. Passport (eligible) wins; else the stored mode;
 * a mode whose creds are missing downgrades to 'direct'.
 */
export function pickLinkStyle(o: {
  passportEligible: boolean
  mode: string | null | undefined
  hasBitly: boolean
  hasGeniuslink: boolean
}): LinkStyle {
  if (o.passportEligible) return 'passport'
  let style = (o.mode || 'direct').toLowerCase()
  if (style === 'bitly' && !o.hasBitly) style = 'direct'
  if (style === 'geniuslink' && !o.hasGeniuslink) style = 'direct'
  if (style !== 'bitly' && style !== 'geniuslink' && style !== 'direct') style = 'direct'
  return style as LinkStyle
}

/**
 * The creator's effective link style + the creds each option needs. Passport ON
 * (and eligible) wins; else the stored blog_social_link_mode; a style with no
 * usable creds is downgraded to 'direct'. One bounded read; never throws.
 */
export async function getLinkStyle(supabase: Db, userId: string): Promise<LinkStyleConfig> {
  const empty: LinkStyleConfig = { style: 'direct', tier: null, bitlyToken: null, geniuslinkKey: null, geniuslinkSecret: null }
  try {
    const { data: ig } = await supabase
      .from('integrations')
      .select('passport_links_enabled, tier, blog_social_link_mode, wrap_blog_geniuslink, bitly_access_token, geniuslink_api_key, geniuslink_api_secret')
      .eq('user_id', userId).maybeSingle()
    if (!ig) return empty
    const tier = (ig.tier as string | null) ?? null
    const bitlyToken = (ig.bitly_access_token as string | null)?.trim() || null
    const geniuslinkKey = (ig.geniuslink_api_key as string | null)?.trim() || null
    const geniuslinkSecret = (ig.geniuslink_api_secret as string | null)?.trim() || null
    // Legacy rows predate blog_social_link_mode: honor the old boolean the same
    // way /api/affiliate-links/save GET does, so a creator who turned on
    // Geniuslink before the chooser existed still resolves to 'geniuslink' (and
    // the chooser UI + the resolvers agree on their style).
    const rawMode = (ig.blog_social_link_mode as string | null) || ''
    const mode = rawMode || (ig.wrap_blog_geniuslink === true ? 'geniuslink' : 'direct')
    const style = pickLinkStyle({
      passportEligible: !!ig.passport_links_enabled && canUsePassport(normalizeTier(tier)),
      mode,
      hasBitly: !!bitlyToken,
      hasGeniuslink: !!(geniuslinkKey && geniuslinkSecret),
    })
    return { style, tier, bitlyToken, geniuslinkKey, geniuslinkSecret }
  } catch {
    return empty
  }
}

export interface CloakOpts {
  supabase: Db
  userId: string
  /** The plain destination to cloak. For an Amazon product this is usually the
   *  tagged /dp/ link; passing `asin` too lets Passport/Geniuslink geo-route. */
  destination: string
  /** Amazon ASIN, when this link is an Amazon product — enables geo-routing. */
  asin?: string | null
  /** Channel context (facebook / pinterest / blog / …) for per-channel groups. */
  channel?: string | null
  /** Display label / title for the created link. */
  label?: string | null
  /** Attribution source baked into a Passport link (per-surface groups + ascsubtag). */
  source?: string | null
  /** Pre-resolved style, to avoid re-reading integrations when cloaking many links
   *  in one request (e.g. every product link in a blog post). */
  config?: LinkStyleConfig
}

/**
 * Turn a destination into the creator's cloaked link per their chosen style.
 * Best-effort: any failure falls back to the plain destination so a link is never
 * lost. Pass `config` (from getLinkStyle) when cloaking many links at once.
 */
export async function resolveCloakedLink(opts: CloakOpts): Promise<string> {
  const dest = (opts.destination || '').trim()
  if (!dest) return dest
  const cfg = opts.config ?? (await getLinkStyle(opts.supabase, opts.userId))
  const asin = (opts.asin || '').trim().toUpperCase()
  const hasAsin = /^[A-Z0-9]{10}$/.test(asin)

  try {
    switch (cfg.style) {
      case 'passport': {
        // Amazon ASIN → geo-routing link; any other URL → cloaked forwarder.
        if (hasAsin) {
          const u = await passportLinkForUser(opts.supabase, opts.userId, asin, { source: opts.source ?? opts.channel ?? null, title: opts.label ?? null })
          return u || dest
        }
        const site = await getDefaultSite(opts.supabase, opts.userId)
        const siteId = site && site.id !== 'legacy' ? (site.id as string) : null
        const code = await getOrCreatePassportLink(opts.supabase, opts.userId, siteId, { destinationUrl: dest, label: opts.label ?? null, source: opts.source ?? opts.channel ?? null })
        return code ? passportLinkUrl(code) : dest
      }
      case 'geniuslink':
        return await channelWrapLink({
          supabase: opts.supabase, destination: dest, channel: opts.channel || 'blog',
          userId: opts.userId, apiKey: cfg.geniuslinkKey, apiSecret: cfg.geniuslinkSecret, label: opts.label ?? undefined,
        })
      case 'bitly': {
        if (!cfg.bitlyToken) return dest
        const short = await shortenBitly(cfg.bitlyToken, dest)
        return short || dest
      }
      case 'direct':
      default:
        return dest
    }
  } catch {
    return dest
  }
}
