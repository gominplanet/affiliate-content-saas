/**
 * Small helpers shared by the social-posting routes (manual + scheduled).
 */

/** Pull an article's og:image (the featured image) from its HTML. Best-effort —
 *  returns null on any failure. Used as the native thumbnail for posts that
 *  have no video (campaigns, guides, comparisons). */
/** Block SSRF-y targets: non-http(s) schemes + private/loopback/link-local hosts
 *  (incl. the cloud metadata IP 169.254.169.254). Defense-in-depth — the URLs we
 *  fetch are owner-controlled (the user's own wordpress_url), but never trust blindly. */
function isSafePublicHttpUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false
  if (/^(0\.|127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return false
  return true
}

export async function fetchOgImage(url: string): Promise<string | null> {
  if (!url || !isSafePublicHttpUrl(url)) return null
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
