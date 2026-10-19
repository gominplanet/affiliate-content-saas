// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// LIVE SPOTS AFTER A SMART-SCAN OR A SEARCH. The catalogue's open spots are only as fresh as
// the last load, so a campaign that filled since then kept showing as open. After
// a Smart-Scan, SCOUT runs the same live search as "Refresh from Amazon" for what
// was scanned (the focus keyword, or the top brands found) and the live counts go
// into the shared catalogue. A campaign that is now full drops out of "Has open
// spots" for every creator. Best effort: a failed lookup changes nothing.

import { requestCcBrandSearch } from '@/lib/extension-frame'
import { fetchWithTimeout } from '@/lib/fetch-timeout'

/** found: campaigns Amazon has for the terms. saved: ones MVP already had,
 *  refreshed. added: new ones the team's search put in MVP's list. notInMvp:
 *  new ones a member's search found, which wait for the team. */
export type LiveSpotsResult = { terms: string[]; found: number; saved: number; added: number; notInMvp: number; nowFull: number; failed: boolean }

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
  const res: LiveSpotsResult = { terms, found: 0, saved: 0, added: 0, notInMvp: 0, nowFull: 0, failed: false }
  for (const t of terms) {
    try {
      const r = await requestCcBrandSearch(t, { maxPages: 5 })
      if (!r.ok) { res.failed = true; continue }
      // EVERY CAMPAIGN AMAZON RETURNED, with a spot count or without. Only
      // the ones with a count were sent, so a brand new campaign Amazon gave
      // no count for was dropped here and the page said "nothing changed".
      const found = r.campaigns || []
      res.found += found.length
      if (!found.length) continue
      const w = await fetchWithTimeout('/api/campaigns/ingest-live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaigns: found }) })
      const d = await w.json().catch(() => null) as { upserted?: number; added?: number; unknown?: number; nowFull?: number } | null
      res.saved += d?.upserted ?? 0
      res.added += d?.added ?? 0
      res.notInMvp += d?.unknown ?? 0
      res.nowFull += d?.nowFull ?? 0
    } catch { res.failed = true }
  }
  return res
}

/** What a live check did, in words: refreshed, added, and the ones Amazon has
 *  that MVP does not yet, each said rather than folded into "nothing changed"
 *  (Seb, 2026-10-19: Amazon had 122 Dreamegg campaigns, MVP none). Pure. */
export function liveCheckWords(r: LiveSpotsResult): string {
  const on = r.terms.join(', ')
  if (!r.found) return r.failed ? `Could not check ${on} live on Amazon (SCOUT is not connected, or Amazon did not answer).` : `Checked ${on} live on Amazon: Amazon has no open campaigns for it right now.`
  const parts = [
    r.saved ? `${r.saved.toLocaleString()} updated${r.nowFull ? `, ${r.nowFull.toLocaleString()} turned out full and are now hidden` : ''}` : '',
    r.added ? `${r.added.toLocaleString()} new to MVP added to the list for everyone` : '',
    r.notInMvp ? `${r.notInMvp.toLocaleString()} ${r.notInMvp === 1 ? 'is' : 'are'} new and not in MVP’s list yet (new campaigns arrive with the next weekly import)` : '',
  ].filter(Boolean)
  return `Checked ${on} live on Amazon: found ${r.found.toLocaleString()}. ${parts.length ? `${parts.join('; ')}.` : 'Nothing about them changed.'}`
}
