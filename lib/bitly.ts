// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Bitly v4 — a FREE alternative to Geniuslink for the social→blog link. A
// Geniuslink click costs money and a blog link earns no commission, so creators
// who just want a short, click-tracked link (not a branded affiliate one) can
// use their own Bitly account instead. They paste a Bitly "generic access
// token" (Bitly → Settings → API → Generate token) in Brand Profile.

/** Shorten a long URL with Bitly. Returns the short link, or null on any
 *  failure (bad token, rate limit, network) so a share never breaks — the
 *  caller falls back to the plain URL. */
export async function shortenBitly(token: string, longUrl: string): Promise<string | null> {
  const t = (token || '').trim()
  const url = (longUrl || '').trim()
  if (!t || !/^https?:\/\//i.test(url)) return null
  try {
    const res = await fetch('https://api-ssl.bitly.com/v4/shorten', {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ long_url: url }),
    })
    // 200 = already shortened before, 201 = created. Both carry { link }.
    if (!res.ok) return null
    const j = (await res.json().catch(() => null)) as { link?: string } | null
    const link = j?.link
    return link && /^https?:\/\//i.test(link) ? link : null
  } catch {
    return null
  }
}

/** Cheap credential check for the "Test connection" button — shortens a
 *  throwaway URL and reports whether Bitly accepted the token. */
export async function testBitlyToken(token: string): Promise<{ ok: boolean; error?: string }> {
  const link = await shortenBitly(token, 'https://example.com/')
  return link ? { ok: true } : { ok: false, error: 'Bitly rejected that token, or the request failed.' }
}
