// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The hook title card's words: the options MVP offers, and what a creator
// types. Pure, shared by the hooks route, the render route and the picker.

/** Longest hook the card shows (it wraps to two or three lines at most). */
export const HOOK_MAX_CHARS = 60

/** One hook, tidied: no line breaks, no dashes, capped. Empty when nothing is left. */
export function cleanHook(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, HOOK_MAX_CHARS)
    .trim()
}

/** Options without blanks or repeats (case-insensitive), at most five. */
export function cleanHookOptions(raw: unknown[]): string[] {
  const out: string[] = []
  for (const r of raw) {
    const h = cleanHook(r)
    if (h && !out.some((o) => o.toLowerCase() === h.toLowerCase())) out.push(h)
    if (out.length >= 5) break
  }
  return out
}
