// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MVP'S OWN THUMBNAIL IS NOT REPLACED BY YOUTUBE'S (Seb, 2026-10-08: some
// Amazon uploads went up with a plain video frame while YouTube showed the
// designed thumbnail). The thumbnail MVP made for a video is the one Amazon
// gets. The hourly YouTube refresh and the channel sync used to write
// YouTube's own image link over it, and for a video still private or
// scheduled that link serves YouTube's auto frame, not the custom thumbnail.

/** An image YouTube serves (its own copy, not one MVP made). */
export function isYouTubeImage(url: string | null | undefined): boolean {
  return /(^https?:\/\/)?([a-z0-9-]+\.)*(ytimg\.com|ggpht\.com|img\.youtube\.com)\//i.test(String(url || ''))
}

/** The thumbnail to keep when YouTube reports one: MVP's own wins. Pure. */
export function keepOwnThumbnail(current: string | null | undefined, fromYouTube: string | null | undefined): string | null {
  if (current && /^https:\/\//i.test(current) && !isYouTubeImage(current)) return current
  return fromYouTube || current || null
}
