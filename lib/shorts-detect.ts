// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Which videos are YouTube Shorts.
//
// WHY IT MATTERS. YouTube does not make links clickable in a Short's
// description or comments, and the Shorts feed shows the Short itself, not a
// 16:9 thumbnail. So a Short given the long-video treatment gets an affiliate
// link nobody can click, a pinned comment whose link is dead, and a thumbnail
// nobody sees. Co-Pilot and Encore both need to know.
//
// THREE ANSWERS, NEVER TWO: true, false, or null for "could not tell". A
// draft still processing, a video on a channel this login cannot read, or a
// network error is null, and callers treat null as "not known to be a Short"
// without claiming it is a regular video either.
//
// HOW. For the creator's own videos, YouTube's API gives the real frame size
// and length (fileDetails and contentDetails, one quota unit per 50 videos):
// a Short is at most 3 minutes and square or taller than wide. That works for
// private drafts too, which a public probe cannot see. For anything the API
// did not answer, youtube.com/shorts/<id> is asked: a Short answers there,
// and a regular video is redirected to /watch.

// A Short is at most three minutes (YouTube's limit since October 2024).
export const SHORT_MAX_SECONDS = 180

/** ISO 8601 duration (PT1M5S) to seconds, or null. */
export function isoSeconds(iso: string | null | undefined): number | null {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''))
  if (!m) return null
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0)
}

/** The rule, from one video's API answer. Pure. */
export function shortFromDetails(input: { durationIso?: string | null; width?: number | null; height?: number | null }): boolean | null {
  const secs = isoSeconds(input.durationIso)
  if (secs === null) return null
  if (secs > SHORT_MAX_SECONDS) return false
  if (!input.width || !input.height) return null
  return input.height >= input.width
}

/** youtube.com/shorts/<id>: a Short answers, a regular video is redirected. */
export async function probeShort(id: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${id}`, {
      method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 MVPAffiliateBot' },
    })
    if (res.status >= 200 && res.status < 300) return true
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') || ''
      return /\/watch/.test(loc) ? false : null
    }
    return null
  } catch { return null }
}

/**
 * Short or not, for up to 200 videos. With the owner's access token the API
 * answers first; the public probe fills in what it could not. Without a
 * token, the probe alone (public videos only).
 */
export async function detectShorts(ids: string[], accessToken?: string | null): Promise<Map<string, boolean | null>> {
  const unique = [...new Set(ids.filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id)))].slice(0, 200)
  const out = new Map<string, boolean | null>(unique.map((id) => [id, null]))
  // Videos the API returned at all. One it returned without a frame size is
  // still processing, and very likely private: the public probe cannot see
  // it properly, so it is left unknown rather than guessed.
  const seenByApi = new Set<string>()
  if (accessToken) {
    for (let i = 0; i < unique.length; i += 50) {
      const batch = unique.slice(i, i + 50)
      try {
        const url = new URL('https://www.googleapis.com/youtube/v3/videos')
        url.searchParams.set('part', 'contentDetails,fileDetails')
        url.searchParams.set('id', batch.join(','))
        url.searchParams.set('maxResults', '50')
        const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) })
        if (!res.ok) continue
        const data = await res.json() as { items?: Array<{ id?: string; contentDetails?: { duration?: string }; fileDetails?: { videoStreams?: Array<{ widthPixels?: number; heightPixels?: number }> } }> }
        for (const v of data.items ?? []) {
          if (!v.id) continue
          seenByApi.add(v.id)
          const stream = v.fileDetails?.videoStreams?.[0]
          out.set(v.id, shortFromDetails({ durationIso: v.contentDetails?.duration, width: stream?.widthPixels, height: stream?.heightPixels }))
        }
      } catch { /* the probe below fills in */ }
    }
  }
  const unknown = unique.filter((id) => out.get(id) === null && !seenByApi.has(id))
  // A few at a time: this is youtube.com, not an API with a quota.
  for (let i = 0; i < unknown.length; i += 10) {
    const part = unknown.slice(i, i + 10)
    const got = await Promise.all(part.map((id) => probeShort(id)))
    part.forEach((id, k) => { if (got[k] !== null) out.set(id, got[k]) })
  }
  return out
}
