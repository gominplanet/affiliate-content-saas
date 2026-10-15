// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A POST'S ADDRESS, CUT AT A WHOLE WORD (Seb, 2026-10-15, auditing a member's
// blog). A slug cut at exactly 60 letters went live as
// "...review-70l-automatic-litter-box-wit" and "...review-doe": a broken word
// in the address of every long title. It is cut at the last whole word that
// fits instead, and a trailing filler word ("and", "with") is dropped. Pure.

const FILLER = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'with', 'to', 'in', 'on', 'or', 'by', 'at', 'is', 'it', 'vs'])

export function shortSlug(raw: string, max = 60): string {
  const s = String(raw || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (s.length <= max) return s
  const words = s.split('-')
  const out: string[] = []
  for (const w of words) {
    if ([...out, w].join('-').length > max) break
    out.push(w)
  }
  while (out.length > 1 && FILLER.has(out[out.length - 1])) out.pop()
  // One word longer than the limit: cut it, there is no whole word to keep.
  return out.length ? out.join('-') : s.slice(0, max).replace(/-+$/g, '')
}
