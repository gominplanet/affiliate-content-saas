// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW FRESH A CAMPAIGN'S OPEN SPOTS ARE (Seb, 2026-10-10: "too many campaigns
// are showing not full but actually are"). Spot counts came from the weekly
// upload and, now and then, a live check by a creator's SCOUT, and the card
// looked the same either way: a five-day-old count read as today's. This says
// which it is, and picks the brands on screen worth re-checking live. Pure.

export const LIVE_STALE_MS = 12 * 3600_000   // a live count older than this is re-checked
export const BROWSER_RECHECK_MS = 6 * 3600_000 // one browser re-checks a brand at most this often
export const LIVE_BRANDS_PER_LOAD = 3

export type SpotFreshness = { spotsCheckedAt: string | null; spotsLive: boolean }

/** The newer of the live check and the upload, and which one it was. */
export function spotFreshness(lastLiveAt: string | null | undefined, importedAt: string | null | undefined): SpotFreshness {
  const live = lastLiveAt ? Date.parse(lastLiveAt) : NaN
  const up = importedAt ? Date.parse(importedAt) : NaN
  if (Number.isFinite(live) && (!Number.isFinite(up) || live >= up)) return { spotsCheckedAt: new Date(live).toISOString(), spotsLive: true }
  if (Number.isFinite(up)) return { spotsCheckedAt: new Date(up).toISOString(), spotsLive: false }
  return { spotsCheckedAt: null, spotsLive: false }
}

function ago(ms: number): string {
  const h = Math.floor(ms / 3600_000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

/** One short line for the card. */
export function spotAgeWords(f: Partial<SpotFreshness>, now = Date.now()): string | null {
  if (!f.spotsCheckedAt) return null
  const t = Date.parse(f.spotsCheckedAt)
  if (!Number.isFinite(t)) return null
  return f.spotsLive ? `Checked live on Amazon ${ago(now - t)}` : `From the weekly upload, ${ago(now - t)}`
}

/** Whether a card's count is old enough to re-check live. */
export function isStale(f: Partial<SpotFreshness>, now = Date.now()): boolean {
  if (!f.spotsCheckedAt) return true
  const t = Date.parse(f.spotsCheckedAt)
  return !Number.isFinite(t) || !f.spotsLive || now - t > LIVE_STALE_MS
}

/**
 * The brands to re-check live: the first few distinct brands among the cards on
 * screen whose counts are stale and that this browser has not just checked.
 */
export function brandsToRecheck(
  cards: Array<{ brand: string | null } & Partial<SpotFreshness>>,
  checkedByBrowser: Record<string, number>,
  now = Date.now(),
  max = LIVE_BRANDS_PER_LOAD,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const c of cards) {
    const b = String(c.brand || '').trim()
    const k = b.toLowerCase()
    if (!b || seen.has(k)) continue
    seen.add(k)
    if (!isStale(c, now)) continue
    const last = checkedByBrowser[k]
    if (last && now - last < BROWSER_RECHECK_MS) continue
    out.push(b)
    if (out.length >= max) break
  }
  return out
}

/** IN AMAZON'S LATEST LIST (Seb, 2026-11-18: "if they're live, if they're
 *  matching with the latest upload that we have synced from Amazon"). Whether
 *  a card's campaign was in the last upload that finished merging. A live
 *  check newer than that upload says more, so then nothing is added. Null
 *  when MVP could not tell (an upload still running, or the read failed),
 *  never a guess. Pure. */
export function latestListWords(f: { inLatest?: boolean | null; latestAt?: string | null } & Partial<SpotFreshness>): { text: string; tone: 'ok' | 'warn' } | null {
  if (f.inLatest == null || !f.latestAt) return null
  const at = Date.parse(f.latestAt)
  if (!Number.isFinite(at)) return null
  const live = f.spotsLive && f.spotsCheckedAt ? Date.parse(f.spotsCheckedAt) : NaN
  if (Number.isFinite(live) && live >= at) return null
  const day = new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return f.inLatest
    ? { text: `In Amazon\u2019s latest list (${day})`, tone: 'ok' }
    : { text: `Not in Amazon\u2019s latest list (${day}): it may have ended or filled`, tone: 'warn' }
}

/** Whether the last upload has finished: staged after the merge finished
 *  means the next upload is filling staging right now. Pure. */
export function latestListReady(drain: { phase?: string; finishedAt?: string } | null | undefined, lastStagedAt: string | null | undefined): boolean {
  if (!drain || drain.phase !== 'done' || !drain.finishedAt) return false
  const done = Date.parse(drain.finishedAt)
  if (!Number.isFinite(done)) return false
  const staged = lastStagedAt ? Date.parse(lastStagedAt) : NaN
  return !(Number.isFinite(staged) && staged > done)
}
