/**
 * Small helpers shared by the social-posting routes (manual + scheduled).
 */

/** Pull an article's og:image (the featured image) from its HTML. Best-effort —
 *  returns null on any failure. Used as the native thumbnail for posts that
 *  have no video (campaigns, guides, comparisons). */
export async function fetchOgImage(url: string): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MVPAffiliate/1.0)' } })
    if (!res.ok) return null
    const html = await res.text()
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
    return m?.[1] || null
  } catch {
    return null
  }
}

/** Remove "link in comments" / bracketed [link …] placeholders an LLM may invent
 *  in a social caption. The real link is the post's image caption or link card,
 *  never a comment — so these placeholders are always wrong/misleading. */
export function stripLinkPlaceholders(text: string): string {
  return (text || '')
    .replace(/\[[^\]]*\blink\b[^\]]*\]/gi, '')                 // [link in comments], [link], [LINK HERE]
    .replace(/\(?\s*link in (?:the )?comments\s*\)?\.?/gi, '') // "link in comments", "(link in comments)"
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
