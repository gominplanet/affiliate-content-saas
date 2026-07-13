// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One source of truth for guaranteeing an FTC affiliate disclosure on every
// long-form social post (LinkedIn, Telegram, Facebook, Pinterest, Threads),
// whether it's published via the scheduled cron or an immediate/bulk push.
// Short-form platforms (X, Bluesky) are character-limited — they carry the blog
// link and the full disclosure lives on the destination post.

export const AFFILIATE_DISCLAIMER_DEFAULT =
  '📌 As an Amazon Associate I earn from qualifying purchases. This post may contain affiliate links — I may earn a small commission at no extra cost to you.'

/** Append the disclaimer to a caption ONLY if it isn't already disclosed — so
 *  every post carries it and a body that already discloses never doubles up.
 *  Per-alternative word boundaries: a leading \b fails before "#" (space→# is
 *  not a boundary), so "#adventure" is correctly NOT treated as "#ad". */
export function ensureDisclaimer(text: string, disclaimer = AFFILIATE_DISCLAIMER_DEFAULT): string {
  const t = (text || '').trim()
  if (/\baffiliate\b|#ad\b|\bamazon associate\b/i.test(t)) return t
  return `${t}\n\n${disclaimer}`
}
