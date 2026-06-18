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

// ── LTK link preview (best-effort metadata for the MVP x LTK Labs tool) ───────
//
// Grab og:title / og:image from the LTK page the creator pasted so we can
// PRE-FILL the form (creator confirms/edits). Deliberately limited:
//   • We follow redirects only WHILE we stay on an LTK-family domain. The moment
//     the chain points OUT to a retailer (Amazon/Nordstrom/etc.) we STOP and do
//     NOT fetch it — that would consume the creator's affiliate click (attribution
//     risk) and retailers often block datacenter-IP bots anyway.
//   • LTK is a JS-rendered SPA, so static OG tags are hit-or-miss; this is an
//     enrichment, never a dependency. Returns nulls on anything generic/failed.

const LTK_HOSTS = /(^|\.)(liketk\.it|shopltk\.com|liketoknow\.it|rewardstyle\.com|rstyle\.me)$/i

function pickMeta(html: string, key: string): string | null {
  // Matches property="og:x" OR name="og:x"/"twitter:x", in either attribute order.
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i')
  const b = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, 'i')
  const m = html.match(a) || html.match(b)
  return m?.[1]?.trim() || null
}

/** True when a scraped title is just LTK chrome ("Shop my LTK", "… | LTK") rather
 *  than a real product name — so we don't pre-fill the form with junk. */
function looksGeneric(title: string): boolean {
  const t = title.trim().toLowerCase()
  if (t.length < 3) return true
  return /^(shop|my ltk|ltk\b|liketoknow|liketk|the ltk app)/.test(t)
    || /'s ltk\b/.test(t)
    || /\bltk shop\b/.test(t)
    || t === 'ltk'
}

/** Strip trailing site-name chrome from an OG title ("Sweater | LTK" → "Sweater"). */
function cleanTitle(raw: string): string {
  return raw
    .replace(/\s*[|–—-]\s*(LTK|LIKEtoKNOW\.?it|ShopLTK|rewardStyle)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface LtkPreview { name: string | null; imageUrl: string | null }

export async function fetchLtkPreview(rawUrl: string): Promise<LtkPreview> {
  const empty: LtkPreview = { name: null, imageUrl: null }
  if (!rawUrl || !isSafePublicHttpUrl(rawUrl)) return empty
  let current = rawUrl
  try {
    for (let hop = 0; hop < 5; hop++) {
      let u: URL
      try { u = new URL(current) } catch { return empty }
      // Once the chain leaves LTK's own domains, stop — don't fetch the retailer.
      if (!LTK_HOSTS.test(u.hostname.toLowerCase())) return empty
      const res = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MVPAffiliate/1.0; +https://www.mvpaffiliate.io)' },
      })
      // Redirect → resolve Location and loop (bounded by the LTK-host check above).
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) return empty
        current = new URL(loc, current).toString()
        continue
      }
      if (!res.ok) return empty
      const html = await res.text()
      const rawTitle = pickMeta(html, 'og:title') || pickMeta(html, 'twitter:title')
        || (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? null)
      const name = rawTitle && !looksGeneric(rawTitle) ? cleanTitle(rawTitle) : null
      let imageUrl: string | null = pickMeta(html, 'og:image') || pickMeta(html, 'twitter:image')
      if (imageUrl) {
        try { imageUrl = new URL(imageUrl, current).toString() } catch { imageUrl = null }
        if (imageUrl && !/^https?:\/\//i.test(imageUrl)) imageUrl = null
      }
      return { name, imageUrl: imageUrl || null }
    }
    return empty
  } catch {
    return empty
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
