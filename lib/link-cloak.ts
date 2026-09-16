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
import { normalizeShowcaseUrl, styleForShowcase, showcaseOverrideFor, styleSwapNote } from '@/lib/post-destination'

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
  /**
   * WHERE THIS CREATOR'S LINKS POINT BY DEFAULT.
   *
   * 'amazon' for everyone who has not chosen otherwise. 'showcase' for a
   * creator who sells through their TikTok Shop and set that as their default
   * (migration 333). Carried here rather than read per-caller because
   * getLinkStyle is already the one read every link path makes, so putting it
   * here means every surface inherits it — including ones written later, which
   * is the failure this is really guarding against.
   */
  destinationDefault: 'amazon' | 'showcase'
  /** Their saved TikTok Shop showcase link, or null. */
  showcaseUrl: string | null
}

/**
 * The creator's effective link style + the creds each option needs. Passport ON
 * (and eligible) wins; else the stored blog_social_link_mode; a style with no
 * usable creds is downgraded to 'direct'. One bounded read; never throws.
 */
export async function getLinkStyle(supabase: Db, userId: string): Promise<LinkStyleConfig> {
  const empty: LinkStyleConfig = {
    style: 'direct', tier: null, bitlyToken: null, geniuslinkKey: null, geniuslinkSecret: null,
    downgradedFrom: null, destinationDefault: 'amazon', showcaseUrl: null,
  }
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
    // A 'showcase' default with no usable link is NOT a showcase default. It
    // would make every link on the account fall back to Amazon and report a
    // fallback on every single post, which is noise rather than information.
    // Treated as 'amazon' here, and the settings screen is where the creator is
    // told their default cannot take effect yet.
    const showcaseUrl = normalizeShowcaseUrl(ig.tiktok_showcase_url as string | null)
    const destinationDefault: 'amazon' | 'showcase' =
      (ig.link_destination_default as string | null) === 'showcase' && showcaseUrl ? 'showcase' : 'amazon'
    return {
      style: picked.style, downgradedFrom: picked.downgradedFrom, tier,
      bitlyToken, geniuslinkKey, geniuslinkSecret,
      destinationDefault, showcaseUrl,
    }
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
  /**
   * Override the account's default destination for THIS link.
   *
   * Omitted (the normal case) means inherit, which is what lets a creator set
   * 'showcase' once and have every surface follow — including surfaces written
   * after this was added, which is the point.
   *
   * 'amazon' forces the affiliate link even on a showcase account (a one-off
   * Amazon post), 'showcase' forces the shop link even on an Amazon account
   * (the per-post toggle from migration 332).
   */
  destinationOverride?: 'amazon' | 'showcase'
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
  let dest = (opts.destination || '').trim()
  if (!dest) return { url: dest, reason: 'no-destination', cloaked: false }
  const cfg = opts.config ?? (await getLinkStyle(opts.supabase, opts.userId))
  let asin = (opts.asin || '').trim().toUpperCase()

  // ── SEND THE CLICKS TO THE CREATOR'S OWN SHOP INSTEAD ────────────────────
  //
  // Applied HERE so every caller inherits it from one place. The three things
  // that have to happen together, each of which fails silently on its own:
  //
  //   1. the destination becomes the shop link
  //   2. THE ASIN IS DROPPED — Passport geo-routes an ASIN to the reader's
  //      local Amazon, so leaving it sends every click to Amazon on a post that
  //      reads as a shop post
  //   3. Geniuslink is skipped — it exists to route Amazon links and nothing
  //      else — falling to Passport, which shortens anything and keeps the
  //      click stats, or to a plain link
  //
  // `useShowcase` is the account default unless this call overrode it.
  const useShowcase = opts.destinationOverride
    ? opts.destinationOverride === 'showcase'
    : cfg.destinationDefault === 'showcase'
  let style = cfg.style
  if (useShowcase && cfg.showcaseUrl) {
    dest = cfg.showcaseUrl
    asin = ''
    style = styleForShowcase(cfg.style, cfg.style === 'passport').style
  }
  const hasAsin = /^[A-Z0-9]{10}$/.test(asin)

  try {
    switch (style) {
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

/**
 * The creator's shop link, cloaked in their style, or null when this account
 * is not a showcase account.
 *
 * For the seven paths that hand-roll their own Passport / Bitly / Geniuslink
 * chain rather than calling resolveCloakedLinkDetailed (the blog writer,
 * comparisons, from-link, campaigns, Link in Bio sync, pin links, the weekly
 * digest). Each gets ONE call at the top of its chain:
 *
 *     const sc = await resolveShowcaseLink(db, userId, cfg)
 *     if (sc) return sc
 *
 * Returning null leaves their Amazon path completely untouched, which matters
 * more than the feature does: these paths build a creator's entire blog, and a
 * refactor that quietly changed the Amazon case would be a much worse bug than
 * this is a good feature.
 *
 * NO ASIN is ever passed on. Passport geo-routes an ASIN to the reader's local
 * Amazon, so a shop link minted from one would send every click to Amazon while
 * the article reads as a shop article.
 */
export async function resolveShowcaseLink(
  supabase: Db,
  userId: string,
  config?: LinkStyleConfig,
  opts?: { label?: string | null; source?: string | null; override?: 'amazon' | 'showcase' },
): Promise<string | null> {
  const cfg = config ?? (await getLinkStyle(supabase, userId))
  const sc = showcaseOverrideFor(cfg, opts?.override)
  if (!sc) return null
  return cloakShopUrl(supabase, userId, cfg, sc.style, sc.url, opts)
}

/**
 * The same thing for ONE PRODUCT, given its URL directly.
 *
 * The account-level showcase is a single front door set in Brand Profile. A
 * TikTok Shop product is a different destination per post, and it comes from
 * the creator's saved products rather than from their settings, so the URL is
 * passed in instead of read.
 *
 * THE URL IS NOT NORMALIZED, EVER. A TikTok product link carries _t and u_code,
 * and those are what credit the sale to the creator. Tidying the link the way
 * an Amazon URL gets tidied would strip the attribution off every post and the
 * loss would only surface in a commission report months later.
 *
 * Every rule the showcase destination follows applies here for the same
 * reasons: Geniuslink only routes Amazon links so the style is swapped, and no
 * ASIN is ever passed on because Passport would geo-route it to Amazon.
 */
export async function resolveProductShopLink(
  supabase: Db,
  userId: string,
  destinationUrl: string,
  config?: LinkStyleConfig,
  opts?: { label?: string | null; source?: string | null },
): Promise<{ url: string; changedFrom: LinkStyle | null; note: string | null } | null> {
  const dest = (destinationUrl || '').trim()
  if (!dest) return null
  const cfg = config ?? (await getLinkStyle(supabase, userId))
  // THE SAME EXPRESSION showcaseOverrideFor uses, character for character, and
  // it has to stay that way. `passportAvailable` means the creator has Passport
  // turned on, which getLinkStyle reports by resolving their style to
  // 'passport'. This first read `cfg.style === 'passport' || cfg.style ===
  // 'geniuslink'`, which is always true for the one creator the question is
  // being asked about and has nothing to do with Passport at all. The effect
  // was that a Geniuslink creator got a Passport link per product and a plain
  // link from their account showcase, which is exactly the drift that putting
  // the minting body in one place was supposed to prevent.
  const swap = styleForShowcase(cfg.style, cfg.style === 'passport')
  const url = await cloakShopUrl(supabase, userId, cfg, swap.style, dest, opts)
  // The note comes from the shared helper rather than being written at the call
  // site, so "Geniuslink was swapped for a plain link, clicks are NOT counted"
  // cannot be reported as "swapped for Passport, clicks are still counted".
  return { url: url ?? dest, changedFrom: swap.changedFrom, note: styleSwapNote(swap.changedFrom, swap.style) }
}

/** Shared body, so the account-level and per-product paths cannot drift. */
async function cloakShopUrl(
  supabase: Db,
  userId: string,
  cfg: LinkStyleConfig,
  style: LinkStyle,
  dest: string,
  opts?: { label?: string | null; source?: string | null },
): Promise<string | null> {
  try {
    if (style === 'passport') {
      const site = await getDefaultSite(supabase, userId)
      const siteId = site && site.id !== 'legacy' ? (site.id as string) : null
      const code = await getOrCreatePassportLink(supabase, userId, siteId, {
        destinationUrl: dest, label: opts?.label ?? null, source: opts?.source ?? 'blog',
      })
      // A failed mint still returns the shop link: the destination the creator
      // chose is what matters, the click counting is the nice-to-have.
      return code ? passportLinkUrl(code) : dest
    }
    if (style === 'bitly' && cfg.bitlyToken) {
      return (await shortenBitly(cfg.bitlyToken, dest)) || dest
    }
    return dest
  } catch {
    return dest
  }
}
