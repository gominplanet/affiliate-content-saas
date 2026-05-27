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
  const cleanHost = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
  const urls = Array.from(new Set(urlList.filter(Boolean))).slice(0, 10000)
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
