// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// KEEP WHAT A BRAND'S TRYBE PAGE SAID (Seb, 2026-11-25: TRYBE's score parts
// "all have to be taken into consideration when MVP gives their
// recommendation"). Wherever SCOUT already reads a brand's own page on the
// member's TRYBE (the brand page, the inbox card, brand scripts, the upload
// picker), its creators, its TRYBE score and the score's three parts are sent
// to 'live_facts', so the MVP pick in every list weighs them. No extra read
// of TRYBE is made for this: only pages the member's SCOUT already opened.
//
// Best effort and once per brand per visit: a save that fails is tried again
// on the next read, and nothing on screen waits for it.

import { readScoreParts } from './trybe-score'
import { readLiveBrand } from './trybe-dossier'

const kept = new Set<string>()

/** Creators and score as numbers, from the live read's figures. Pure. */
export function liveFactsOf(json: unknown): { creators: number | null; score: number | null; parts: ReturnType<typeof readScoreParts>; rating: number | null; reviews: number | null; earnings: string | null } {
  const read = readLiveBrand(json)
  const n = (id: string) => { const v = read.numbers.find((x) => x.id === id)?.value; const f = v ? parseFloat(v.replace(/[^0-9.]/g, '')) : NaN; return Number.isFinite(f) ? f : null }
  // Its rating, how many rated it, and its earnings: newer on its page than
  // in MVP's copy of TRYBE's list (Chef Preserve: 146 reviews there, 22 here).
  return { creators: n('creators'), score: n('score'), parts: readScoreParts(json), rating: n('rating'), reviews: read.ratingCount ?? null, earnings: read.numbers.find((x) => x.id === 'earnings')?.value ?? null }
}

/** Send what the page showed, once per brand per visit. */
export function keepTrybeFacts(brandId: string | null | undefined, json: unknown): void {
  if (!brandId || kept.has(brandId) || typeof fetch === 'undefined') return
  let facts: ReturnType<typeof liveFactsOf>
  try { facts = liveFactsOf(json) } catch { return }
  if (facts.creators == null && facts.score == null && !facts.parts && facts.rating == null && !facts.earnings) return
  kept.add(brandId)
  // A refusal (TRYBE Free, signed out) is not tried again this visit; a
  // server that failed is.
  void fetch('/api/labs/trybe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'live_facts', brandId, ...facts }),
    signal: AbortSignal.timeout(15_000),
  }).then((r) => { if (r.status >= 500) kept.delete(brandId) }).catch(() => { kept.delete(brandId) })
}
