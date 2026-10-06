// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// LIVE SPOTS AFTER A SMART-SCAN. The catalogue's open spots are only as fresh as
// the last load, so a campaign that filled since then kept showing as open. After
// a Smart-Scan, SCOUT runs the same live search as "Refresh from Amazon" for what
// was scanned (the focus keyword, or the top brands found) and the live counts go
// into the shared catalogue. A campaign that is now full drops out of "Has open
// spots" for every creator. Best effort: a failed lookup changes nothing.

import { requestCcBrandSearch } from '@/lib/extension-frame'
import { fetchWithTimeout } from '@/lib/fetch-timeout'

export type LiveSpotsResult = { terms: string[]; found: number; saved: number; nowFull: number; failed: boolean }

/** The terms to look up: the focus keyword, or up to `max` distinct brands. Pure. */
export function liveSpotTerms(focus: string, brands: Array<string | null | undefined>, max = 3): string[] {
  const f = focus.trim()
  if (f) return [f]
  const seen = new Set<string>()
  const out: string[] = []
  for (const b of brands) {
    const t = String(b || '').trim()
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

export async function refreshLiveSpots(terms: string[]): Promise<LiveSpotsResult> {
  const res: LiveSpotsResult = { terms, found: 0, saved: 0, nowFull: 0, failed: false }
  for (const t of terms) {
    try {
      const r = await requestCcBrandSearch(t, { maxPages: 5 })
      if (!r.ok) { res.failed = true; continue }
      const withSpots = (r.campaigns || []).filter((c) => (c as { availableSlot?: number | null }).availableSlot != null)
      res.found += withSpots.length
      if (!withSpots.length) continue
      const w = await fetchWithTimeout('/api/campaigns/ingest-live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaigns: withSpots }) })
      const d = await w.json().catch(() => null) as { upserted?: number; nowFull?: number } | null
      res.saved += d?.upserted ?? 0
      res.nowFull += d?.nowFull ?? 0
    } catch { res.failed = true }
  }
  return res
}
