// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// NICHE GROUPS. A creator runs one Facebook Page and a Group per niche
// (Kitchen, Automotive...). Each saved Group carries its niche and a few words
// that describe it, and a clip or review goes to the Group whose words match
// it best: the kitchen Reel's Group post lands in the Kitchen Group, and the
// Page Reel links there. The creator can always pick another Group. Pure.

export type NicheGroup = { name: string; url: string; niche?: string | null; keywords?: string | null }

function words(s: string | null | undefined): string[] {
  return String(s || '').toLowerCase().split(/[,;\n]+/).map((w) => w.trim()).filter((w) => w.length >= 2)
}

/** The index of the Group whose niche words appear most in the text; the
 *  first Group when none match (or there is only one). */
export function pickNicheGroup(groups: NicheGroup[], text: string | null | undefined): number {
  if (groups.length <= 1) return 0
  const hay = ` ${String(text || '').toLowerCase()} `
  let best = 0, bestScore = 0
  groups.forEach((g, i) => {
    const terms = [...words(g.keywords), ...words(g.niche)]
    const score = terms.reduce((n, t) => n + (hay.includes(t) ? (t.includes(' ') ? 2 : 1) : 0), 0)
    if (score > bestScore) { best = i; bestScore = score }
  })
  return best
}

/** A saved Group, cleaned: niche and words kept when present. */
export function cleanNicheGroup(raw: unknown): NicheGroup | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Record<string, unknown>
  if (typeof g.url !== 'string' || !g.url.trim()) return null
  const s = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
  return { name: s(g.name, 80) || 'Facebook Group', url: g.url.trim(), niche: s(g.niche, 40), keywords: s(g.keywords, 300) }
}
