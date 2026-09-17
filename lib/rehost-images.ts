// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// PULL A CREATOR'S PICTURES ONTO THEIR OWN SITE.
//
// When a site refuses a media upload, the generator does not fail the post. It
// embeds the URL it generated the picture from, so the article still reads
// properly. That fallback is the right call in the moment and it leaves a debt:
// the post now depends on our generation CDN for a picture the creator believes
// is theirs.
//
// Six creators are carrying 186 such posts. One of them had not accepted an
// image onto his own domain since August and had no way to know, because the
// posts look finished.
//
// fal's own documentation settles how much that matters:
//
//   "Expired files are permanently deleted and cannot be recovered. Download
//    files before they expire if you need them later."
//
// Retention is listed as "Configurable" with no published default, and MVP does
// not send the lifecycle header, so we are on whatever fal chooses. That is not
// a deadline anyone can quote, which is exactly why the debt should not be left
// sitting.
//
// So this module answers one question: given the HTML of a published post, which
// pictures should be moved onto the creator's own site? Pure, because the rule
// is the whole thing and a rule buried in a route can only be checked by having
// a broken site to hand.
//
// WHAT IT DELIBERATELY LEAVES ALONE:
//
//   the creator's own domain   already theirs, nothing to do
//   Amazon (m.media-amazon)    product photos are Amazon's to serve, and their
//                              terms are the reason we point at them rather
//                              than copying them onto someone's blog
//   YouTube (i.ytimg)          the creator's own video thumbnails, served by
//                              Google, stable and not ours to duplicate
//   data: URIs                 already inline, nothing to fetch
//
// Only the pictures MVP generated and failed to hand over are moved. Anything
// broader would be copying other people's files onto a creator's server.

/**
 * Hosts holding pictures MVP generated. These are the ones that expire, and
 * they are the ONLY thing this moves.
 *
 * AN ALLOW-LIST, and it is the single rule. The first version also carried a
 * deny-list naming Amazon, YouTube, Gravatar and WordPress core, which read as
 * careful and was dead code: nothing on it could reach the allow-list anyway.
 * Worse, the two covered for each other, so deleting either one changed no
 * behaviour and no test could tell. Two rules where one is load-bearing is a
 * rule nobody can check.
 *
 * So there is one rule, and what it excludes is listed in NOT_OURS below purely
 * so the test can hold it to that.
 */
const OUR_GENERATION_HOSTS = /(^|\.)fal\.media$|(^|\.)fal\.run$/i

/** Does this host hold a picture MVP generated? The whole selection rule. */
export function isOurGeneratedHost(host: string): boolean {
  return OUR_GENERATION_HOSTS.test(host)
}

/**
 * Hosts that must never be moved, and why. NOT a filter: the allow-list above
 * already excludes everything not ours. This exists so the test can prove that,
 * and so the reasoning survives for whoever widens the rule later.
 */
export const NOT_OURS = [
  { host: 'm.media-amazon.com', why: "Amazon's product photos, served by Amazon, pointed at deliberately" },
  { host: 'i.ytimg.com', why: "the creator's own YouTube thumbnails, served by Google" },
  { host: 'www.youtube.com', why: 'YouTube' },
  { host: 'secure.gravatar.com', why: 'avatars' },
  { host: 's.w.org', why: 'WordPress emoji and core assets' },
  { host: 'images.unsplash.com', why: 'a stock library, not ours to copy onto a creator server' },
  { host: 'cdn.shopify.com', why: "somebody else's storefront" },
  { host: 'res.cloudinary.com', why: 'another image host entirely' },
]

export interface RehostCandidate {
  url: string
  /** Where it appears in the HTML, for a stable replace. */
  occurrences: number
}

/** The host of a URL, or null when it is not an absolute http(s) URL. */
function hostOf(url: string): string | null {
  try {
    const u = new URL(url)
    return /^https?:$/.test(u.protocol) ? u.host : null
  } catch {
    return null
  }
}

/** Is this the creator's own site? Compared on host, since a site can be
 *  reached over http or https and with or without a path. */
export function isOwnHost(url: string, siteUrl: string | null | undefined): boolean {
  const a = hostOf(url)
  const b = hostOf(siteUrl ?? '') ?? (siteUrl ?? '').replace(/^https?:\/\//, '').split('/')[0]
  if (!a || !b) return false
  const norm = (h: string) => h.toLowerCase().replace(/^www\./, '')
  return norm(a) === norm(b)
}

/**
 * Every picture in this post that should be moved onto the creator's site.
 *
 * Returns each URL once, with how many times it appears, so a rewrite can
 * replace them all and a report can say what it touched.
 */
export function findRehostable(html: string, siteUrl: string | null | undefined): RehostCandidate[] {
  const counts = new Map<string, number>()

  for (const m of html.matchAll(/<img[^>]*\ssrc=["']([^"']+)["']/gi)) {
    const url = m[1]
    if (url.startsWith('data:')) continue
    const host = hostOf(url)
    if (!host) continue
    // REDUNDANT TODAY, AND KEPT ON PURPOSE. The allow-list below already
    // excludes the creator's domain, so removing this line changes nothing and
    // no test through this function can see it. It stays because "never move a
    // picture that is already theirs" is a correctness property in its own
    // right, independent of which hosts count as ours, and it is the line that
    // would matter first if that list were ever widened. isOwnHost is tested
    // directly rather than through here, since through here it proves nothing.
    if (isOwnHost(url, siteUrl)) continue
    if (!isOurGeneratedHost(host)) continue
    counts.set(url, (counts.get(url) ?? 0) + 1)
  }

  return [...counts.entries()].map(([url, occurrences]) => ({ url, occurrences }))
}

/**
 * Swap one URL for another everywhere it appears in the HTML.
 *
 * A plain split/join rather than a RegExp, because a fal URL contains
 * characters that are meaningful in a pattern and building one from a URL is
 * how a rewrite quietly matches the wrong thing or nothing at all.
 */
export function replaceImageUrl(html: string, from: string, to: string): string {
  if (!from || from === to) return html
  return html.split(from).join(to)
}

export type RehostOutcome = 'moved' | 'refused' | 'unreachable' | 'nothing-to-do'

export interface RehostReport {
  outcome: RehostOutcome
  /** Pictures now on the creator's own site. */
  moved: number
  /** Pictures we tried and could not move, with why. */
  failed: { url: string; reason: string }[]
  /** One sentence, safe to render. */
  headline: string
}

/**
 * What to tell the creator, from what actually happened.
 *
 * The distinction that matters: a post where every picture failed to move is a
 * site still refusing uploads, and saying "0 pictures moved" to that person
 * reads as the tool being broken rather than their site. Those get different
 * sentences.
 */
export function describeRehost(moved: number, failed: { url: string; reason: string }[], attempted: number): RehostReport {
  if (attempted === 0) {
    return {
      outcome: 'nothing-to-do',
      moved: 0,
      failed,
      headline: 'Every picture in these posts is already on your own site. Nothing needed moving.',
    }
  }
  if (moved === 0) {
    return {
      outcome: 'refused',
      moved: 0,
      failed,
      headline: `Your site would not accept any of the ${attempted} pictures, so nothing was moved. That is the same block that put them on our server in the first place. Run the picture test above, clear what it finds, then try this again.`,
    }
  }
  if (failed.length > 0) {
    return {
      outcome: 'moved',
      moved,
      failed,
      headline: `Moved ${moved} of ${attempted} pictures onto your site. The other ${failed.length} would not upload, and the reason is listed below each one.`,
    }
  }
  return {
    outcome: 'moved',
    moved,
    failed,
    headline: `Moved ${moved} ${moved === 1 ? 'picture' : 'pictures'} onto your own site. Those posts no longer depend on ours.`,
  }
}
