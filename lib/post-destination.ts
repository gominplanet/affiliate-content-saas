// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying,
// redistribution, reverse-engineering, or reuse. See LICENSE.
//
// WHERE A POST'S LINK POINTS.
//
// Until now the answer was always "the creator's tagged Amazon product page",
// and the only question was which cloaker wrapped it (lib/link-style). A
// creator who sells the same product through their TikTok Shop showcase wants
// the opposite: keep the post, send the click somewhere else entirely.
//
// So this is a DESTINATION decision, not a fifth link style. The cloaking layer
// is unchanged and still wraps whatever it is handed.
//
// Three things follow from that, and each one is a way to get this wrong:
//
//   1. NO AMAZON TAG. The Amazon destination is built as
//      `amazon.com/dp/<asin>?tag=<tag>`. A showcase post replaces that whole
//      string. Appending a tag to a TikTok URL would be meaningless at best.
//
//   2. NO ASIN TO THE CLOAKER. Passport geo-routes an ASIN to the reader's
//      local Amazon. Handing it the ASIN alongside a TikTok destination would
//      send every click to Amazon anyway and the post would look correct while
//      doing the exact opposite of what was asked.
//
//   3. NO GENIUSLINK. Geniuslink exists to geo-route Amazon links. A TikTok URL
//      through a Geniuslink account is broken or wrong depending on the day.
//      Passport shortens anything, so showcase links still get click stats;
//      Bitly is a generic shortener and is fine too.
//
// And the part that is not about links at all: a deal caption quotes Amazon
// price history ("about 52% off", "the lowest price we've tracked"). Those
// facts are about a store the reader is no longer being sent to. Quoting them
// over a TikTok link is not a cosmetic mismatch, it is a false claim about a
// price on a page nobody is visiting. `suppressAmazonClaims` is how every
// writer path is told to stop.

import type { LinkStyle } from '@/lib/link-style'

export type DestinationKind = 'amazon' | 'showcase'

/** Why a post that asked for the showcase did not get one. */
export type ShowcaseFallback =
  | 'no-url'    // the toggle is on and no showcase link is saved or pasted
  | 'bad-url'   // what was pasted is not a TikTok showcase link

export interface PostDestination {
  kind: DestinationKind
  /** The URL to hand the cloaker. */
  url: string
  /**
   * What to pass as the cloaker's `asin`. NULL for a showcase — see note 2 in
   * the header. This is the field most likely to be filled in "helpfully" by a
   * future caller who has the ASIN to hand and does not know why it is absent.
   */
  asinForCloak: string | null
  /** Amazon price facts must not appear in copy for this post. */
  suppressAmazonClaims: boolean
  /** Which cloak styles make sense for this destination. */
  allowedStyles: LinkStyle[]
  /** Set when the showcase was asked for and not used. */
  fallback: ShowcaseFallback | null
  /** One sentence for the screen. Null when nothing went wrong. */
  note: string | null
}

/**
 * Hosts a TikTok Shop showcase link actually lives on.
 *
 * Validated rather than accepting any URL, because the failure is silent and
 * expensive: a mistyped link publishes to real social accounts and every click
 * for the life of the post goes nowhere. A creator would rather be told at the
 * paste than find out from their analytics.
 */
const TIKTOK_HOSTS = [
  'tiktok.com',
  'vt.tiktok.com',
  'vm.tiktok.com',
  'shop.tiktok.com',
  'shop-tiktok.com',
]

/** Is this a TikTok link we are willing to send a creator's audience to? */
export function isTikTokShowcaseUrl(raw: string | null | undefined): boolean {
  const s = String(raw ?? '').trim()
  if (!s) return false
  let u: URL
  try { u = new URL(s) } catch { return false }
  // http would downgrade every click; TikTok is https-only anyway.
  if (u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  return TIKTOK_HOSTS.some(h => host === h || host.endsWith(`.${h}`))
}

/** Trim and validate a pasted showcase URL. Null when it is not usable. */
export function normalizeShowcaseUrl(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  // A creator pasting from the TikTok app often gets a bare host with no
  // scheme. Add one rather than rejecting something that is obviously right.
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
  return isTikTokShowcaseUrl(withScheme) ? withScheme : null
}

/** What to tell a creator whose showcase link was not accepted. */
export const SHOWCASE_URL_HINT =
  'That is not a TikTok showcase link. Open your TikTok Shop showcase, tap Share, copy the link, and paste it here. It should start with https:// and be a tiktok.com address.'

/** The tagged Amazon product URL, the destination this all used to assume. */
export function amazonDestination(asin: string, amazonTag: string | null | undefined): string {
  const tag = (amazonTag || '').trim()
  return tag
    ? `https://www.amazon.com/dp/${asin}?tag=${encodeURIComponent(tag)}`
    : `https://www.amazon.com/dp/${asin}`
}

/**
 * Where this post's link points, and what that means for its copy.
 *
 * Falling back to Amazon when the showcase is unusable is deliberate: a post
 * must still publish with a working link. It is also REPORTED, every time,
 * because a silent fallback here is indistinguishable from the creator's own
 * choice and they would keep publishing Amazon links believing otherwise. That
 * exact failure, one layer down in the cloaker, had a creator hand-editing her
 * published Facebook posts for days.
 */
export function resolvePostDestination(opts: {
  asin: string | null | undefined
  amazonTag: string | null | undefined
  /** The creator turned the showcase toggle on for this post. */
  useShowcase: boolean
  /** The per-post override, or their saved default. */
  showcaseUrl: string | null | undefined
}): PostDestination {
  const asin = (opts.asin || '').trim().toUpperCase()
  const amazon: PostDestination = {
    kind: 'amazon',
    url: amazonDestination(asin, opts.amazonTag),
    asinForCloak: asin || null,
    suppressAmazonClaims: false,
    allowedStyles: ['passport', 'geniuslink', 'bitly', 'direct'],
    fallback: null,
    note: null,
  }

  if (!opts.useShowcase) return amazon

  const raw = String(opts.showcaseUrl ?? '').trim()
  if (!raw) {
    return {
      ...amazon,
      fallback: 'no-url',
      note: 'You asked to send clicks to your TikTok showcase, but no showcase link is saved. This post links to Amazon instead. Add your showcase link in Settings, or paste one on the post.',
    }
  }

  const url = normalizeShowcaseUrl(raw)
  if (!url) {
    return {
      ...amazon,
      fallback: 'bad-url',
      note: `This post links to Amazon instead of your TikTok showcase. ${SHOWCASE_URL_HINT}`,
    }
  }

  return {
    kind: 'showcase',
    url,
    // Deliberately null. See note 2 in the file header.
    asinForCloak: null,
    suppressAmazonClaims: true,
    // No geniuslink: it geo-routes Amazon links and nothing else.
    allowedStyles: ['passport', 'bitly', 'direct'],
    fallback: null,
    note: null,
  }
}

/**
 * The cloak style to actually use for this destination.
 *
 * A creator on Geniuslink who turns the showcase on does not lose their link
 * style everywhere, only on this post, and Passport (or a plain link) carries
 * it instead. Returns the style plus whether it was changed, so the screen can
 * say why their usual shortener is not on this one.
 */
export function styleForDestination(
  dest: PostDestination,
  style: LinkStyle,
  opts?: { passportAvailable?: boolean },
): { style: LinkStyle; changedFrom: LinkStyle | null } {
  if (dest.allowedStyles.includes(style)) return { style, changedFrom: null }
  // Passport shortens any destination and keeps click stats, so it is the best
  // replacement when it is available to this creator.
  const replacement: LinkStyle = opts?.passportAvailable ? 'passport' : 'direct'
  return { style: replacement, changedFrom: style }
}

/** The sentence to show when a style was swapped for the destination. */
export function styleSwapNote(changedFrom: LinkStyle | null, to: LinkStyle): string | null {
  if (!changedFrom) return null
  if (changedFrom === 'geniuslink') {
    return to === 'passport'
      ? 'Geniuslink only routes Amazon links, so this post uses a Passport link to your showcase instead. Clicks are still counted.'
      : 'Geniuslink only routes Amazon links, so this post carries your showcase link directly. Clicks on it are not counted.'
  }
  return `Your usual ${changedFrom} link does not work for a showcase destination, so this post uses ${to === 'direct' ? 'the plain link' : `a ${to} link`}.`
}

/**
 * The FTC line for a post.
 *
 * The default names Amazon Associates, which is a specific claim about where
 * the money comes from. On a showcase post it is simply untrue, and the
 * Associates Operating Agreement is not the kind of thing to be casually wrong
 * about. The material connection still exists, so the disclosure still ships,
 * it just stops naming the wrong programme.
 */
export const SHOWCASE_DISCLAIMER =
  '📌 This post contains affiliate links. I may earn a small commission at no extra cost to you.'

export function disclaimerForDestination(kind: DestinationKind, creatorDisclaimer: string | null | undefined, amazonDefault: string): string {
  const own = (creatorDisclaimer || '').trim()
  if (own) return own
  return kind === 'showcase' ? SHOWCASE_DISCLAIMER : amazonDefault
}
