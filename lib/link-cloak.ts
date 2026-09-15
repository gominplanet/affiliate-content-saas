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
import { channelWrapLink, channelWrapLinkDetailed } from '@/lib/channel-share-url'
import { shortenBitly } from '@/lib/bitly'
import { getDefaultSite } from '@/lib/wordpress-sites'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

// The style decision itself lives in lib/link-style so channel-share-url can ask
// the same question without an import cycle. Re-exported here because every
// caller already reaches for link-cloak.
export type { LinkStyle } from '@/lib/link-style'
export { pickLinkStyle } from '@/lib/link-style'
import type { LinkStyle } from '@/lib/link-style'
import { pickLinkStyle, pickLinkStyleDetailed } from '@/lib/link-style'

export interface LinkStyleConfig {
  style: LinkStyle
  tier: string | null
  bitlyToken: string | null
  geniuslinkKey: string | null
  geniuslinkSecret: string | null
  /** The style the creator actually SAVED, when we had to downgrade them to
   *  'direct' because its credentials were missing. null when 'direct' is
   *  genuinely their choice.
   *
   *  Without this, a creator whose Geniuslink keys vanished is indistinguishable
   *  from one who wants plain links, and every layer above behaves correctly for
   *  a decision she never made. */
  downgradedFrom: LinkStyle | null
}

/**
 * The creator's effective link style + the creds each option needs. Passport ON
 * (and eligible) wins; else the stored blog_social_link_mode; a style with no
 * usable creds is downgraded to 'direct'. One bounded read; never throws.
 */
export async function getLinkStyle(supabase: Db, userId: string): Promise<LinkStyleConfig> {
  const empty: LinkStyleConfig = { style: 'direct', tier: null, bitlyToken: null, geniuslinkKey: null, geniuslinkSecret: null, downgradedFrom: null }
  try {
    // select('*'), NOT a named column list, and this is the whole reason the
    // feature was dead in production. blog_social_link_mode ships in migration
    // 274; on a database where that migration has not run, naming it makes
    // PostgREST reject the ENTIRE read, so `ig` came back null and every single
    // creator resolved to 'direct' no matter what they had chosen. A missing
    // migration should cost the one column it added, not every creator's link
    // style, and there is nothing on screen that could ever have shown it: the
    // chooser reads through a route that already used select('*') and so
    // displayed the right answer while generation used the wrong one.
    const { data: ig } = await supabase
      .from('integrations')
      .select('*')
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
    // An unset mode stays unset rather than becoming 'direct' here: pickLinkStyle
    // reads that silence against the creator's stored credentials.
    const rawMode = (ig.blog_social_link_mode as string | null) || ''
    const mode = rawMode || (ig.wrap_blog_geniuslink === true ? 'geniuslink' : '')
    const picked = pickLinkStyleDetailed({
      passportEligible: !!ig.passport_links_enabled && canUsePassport(normalizeTier(tier)),
      mode,
      hasBitly: !!bitlyToken,
      hasGeniuslink: !!(geniuslinkKey && geniuslinkSecret),
    })
    return { style: picked.style, downgradedFrom: picked.downgradedFrom, tier, bitlyToken, geniuslinkKey, geniuslinkSecret }
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
export type CloakReason =
  | 'ok'                    // the link was cloaked as the creator asked
  | 'direct'                // 'direct' style: a plain link is the correct answer
  | 'no-destination'
  | 'passport-mint-failed'  // Passport chosen, the ASIN link would not mint
  | 'passport-no-code'      // Passport chosen, the forwarder would not create
  | 'geniuslink-no-creds'   // Geniuslink chosen, keys missing or not the style
  | 'geniuslink-no-group'
  | 'geniuslink-api-failed'
  | 'geniuslink-error'
  | 'geniuslink-unknown-channel'
  | 'bitly-no-token'
  | 'bitly-failed'
  | 'style-downgraded'      // saved style had no credentials; silently became direct
  | 'error'

export interface CloakResult {
  url: string
  reason: CloakReason
  /** false = a PLAIN, uncloaked link is about to be published. */
  cloaked: boolean
}

/**
 * The same resolution, but it says what happened.
 *
 * resolveCloakedLink has six exits that quietly return the plain destination,
 * and five of them are failures. On 2026-09-12 a paying creator sent a
 * screenshot of her own published Facebook post carrying a raw
 * amazon.com/dp/...?tag=... link. Her style was Geniuslink, her keys had stopped
 * working, and every layer did exactly what it was told: fall back so the post
 * still goes out. Nothing told her, so she had been editing links by hand on
 * Facebook, one post at a time, believing that was the product.
 *
 * The fallback behaviour is unchanged and still right: a post must never fail
 * to publish because a shortener is down. What changes is that the caller can
 * now say so, which is the difference between a degraded post and an invisible
 * one.
 */
export async function resolveCloakedLinkDetailed(opts: CloakOpts): Promise<CloakResult> {
  const dest = (opts.destination || '').trim()
  if (!dest) return { url: dest, reason: 'no-destination', cloaked: false }
  const cfg = opts.config ?? (await getLinkStyle(opts.supabase, opts.userId))
  const asin = (opts.asin || '').trim().toUpperCase()
  const hasAsin = /^[A-Z0-9]{10}$/.test(asin)

  try {
    switch (cfg.style) {
      case 'passport': {
        // Amazon ASIN → geo-routing link; any other URL → cloaked forwarder.
        if (hasAsin) {
          const u = await passportLinkForUser(opts.supabase, opts.userId, asin, { source: opts.source ?? opts.channel ?? null, title: opts.label ?? null })
          return u ? { url: u, reason: 'ok', cloaked: true } : { url: dest, reason: 'passport-mint-failed', cloaked: false }
        }
        const site = await getDefaultSite(opts.supabase, opts.userId)
        const siteId = site && site.id !== 'legacy' ? (site.id as string) : null
        const code = await getOrCreatePassportLink(opts.supabase, opts.userId, siteId, { destinationUrl: dest, label: opts.label ?? null, source: opts.source ?? opts.channel ?? null })
        return code
          ? { url: passportLinkUrl(code), reason: 'ok', cloaked: true }
          : { url: dest, reason: 'passport-no-code', cloaked: false }
      }
      case 'geniuslink': {
        const w = await channelWrapLinkDetailed({
          supabase: opts.supabase, destination: dest, channel: opts.channel || 'blog',
          userId: opts.userId, apiKey: cfg.geniuslinkKey, apiSecret: cfg.geniuslinkSecret, label: opts.label ?? undefined,
        })
        if (w.reason === 'ok' || w.reason === 'already-wrapped') return { url: w.url, reason: 'ok', cloaked: true }
        const map: Record<string, CloakReason> = {
          'no-creds': 'geniuslink-no-creds', 'no-group': 'geniuslink-no-group',
          'api-failed': 'geniuslink-api-failed', 'error': 'geniuslink-error',
          'unknown-channel': 'geniuslink-unknown-channel', 'no-destination': 'no-destination',
        }
        return { url: w.url, reason: map[w.reason] ?? 'error', cloaked: false }
      }
      case 'bitly': {
        if (!cfg.bitlyToken) return { url: dest, reason: 'bitly-no-token', cloaked: false }
        const short = await shortenBitly(cfg.bitlyToken, dest)
        return short ? { url: short, reason: 'ok', cloaked: true } : { url: dest, reason: 'bitly-failed', cloaked: false }
      }
      case 'direct':
      default:
        // 'direct' has two completely different meanings and telling them apart
        // is the whole point. Chosen, it is not a failure and saying anything
        // would cry wolf on everybody who picked it. DOWNGRADED, it means the
        // creator asked for Geniuslink or Bitly, the credentials were missing,
        // and a plain link is going out under a style she never selected.
        return cfg.downgradedFrom
          ? { url: dest, reason: 'style-downgraded', cloaked: false }
          : { url: dest, reason: 'direct', cloaked: true }
    }
  } catch {
    return { url: dest, reason: 'error', cloaked: false }
  }
}

/**
 * What to tell the creator when their link did not get cloaked. null when
 * nothing went wrong, so a caller can write `if (note) show(note)`.
 *
 * Names the style they chose and what to check, because "link not cloaked" sends
 * somebody to the wrong settings page.
 */
export function cloakFallbackNote(r: CloakResult): string | null {
  if (r.cloaked) return null
  switch (r.reason) {
    case 'passport-mint-failed':
    case 'passport-no-code':
      return 'Passport is your link style, but the Passport link could not be created, so this went out with your plain Amazon link instead.'
    case 'geniuslink-no-creds':
      return 'Geniuslink is your link style, but your API key and secret are not working, so this went out with your plain Amazon link. Re-enter them under External Integrations.'
    case 'geniuslink-no-group':
      return 'Geniuslink is your link style, but the tracking group for this channel could not be created, so this went out with your plain Amazon link.'
    case 'geniuslink-api-failed':
    case 'geniuslink-error':
      return 'Geniuslink is your link style, but Geniuslink did not return a short link, so this went out with your plain Amazon link. Usually a temporary outage.'
    case 'style-downgraded':
      // The one she actually hit. Names the style she SAVED, because "links are
      // going out plain" sends somebody to the wrong screen entirely.
      return 'Your saved link style could not be used because its API credentials are missing, so this went out with your plain Amazon link. Re-enter them under External Integrations and check the Link style setting saved.'
    case 'bitly-no-token':
      return 'Bitly is your link style, but no Bitly token is saved, so this went out with your plain Amazon link.'
    case 'bitly-failed':
      return 'Bitly is your link style, but Bitly did not return a short link, so this went out with your plain Amazon link.'
    default:
      return 'This went out with your plain Amazon link rather than your chosen link style.'
  }
}

/** Unchanged contract for callers that only want the URL. */
export async function resolveCloakedLink(opts: CloakOpts): Promise<string> {
  return (await resolveCloakedLinkDetailed(opts)).url
}
