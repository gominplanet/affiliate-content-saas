// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// IndexNow — instantly notify Bing / Copilot / Yandex of new or updated URLs
// (Google doesn't participate). The protocol requires a key file hosted on the
// TARGET site's own domain (gominreviews.com/{key}.txt) — served by the MVP
// WordPress plugin (v1.0.11+). MVP's backend does the actual submission here.

export async function submitToIndexNow(
  host: string,
  key: string,
  urlList: string[],
): Promise<{ ok: boolean; status: number; submitted: number }> {
  // The host exactly as the site serves it. IndexNow refuses URLs whose host is
  // not the one named here, so stripping "www." made every submission from a
  // www site fail. The key file lives on this same host.
  // So the host comes from the post addresses themselves (WordPress's own
  // permalinks), matched to the site with or without "www.".
  const bare = (h: string) => h.toLowerCase().replace(/^www\./, '')
  const siteHost = bare(host.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
  const hostOf = (u: string) => { try { return new URL(u).host.toLowerCase() } catch { return '' } }
  const urls = Array.from(new Set(urlList.filter(Boolean).filter((u) => bare(hostOf(u)) === siteHost))).slice(0, 10000)
  const cleanHost = urls.length ? hostOf(urls[0]) : siteHost
  // One host per submission: drop any stragglers spelled the other way.
  for (let i = urls.length - 1; i >= 0; i--) if (hostOf(urls[i]) !== cleanHost) urls.splice(i, 1)
  if (!cleanHost || !key || urls.length === 0) return { ok: false, status: 0, submitted: 0 }

  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: cleanHost,
        key,
        keyLocation: `https://${cleanHost}/${key}.txt`,
        urlList: urls,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    // IndexNow returns 200 (ok) or 202 (accepted/validating).
    return { ok: res.status === 200 || res.status === 202, status: res.status, submitted: urls.length }
  } catch {
    return { ok: false, status: 0, submitted: 0 }
  }
}
