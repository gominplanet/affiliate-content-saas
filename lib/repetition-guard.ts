// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Self-repetition guard.
//
// Left alone, an AI writer settles into the same handful of openings and pet
// phrases across a creator's whole catalog ("If you're anything like me...",
// "Let's be real...", "In a world where..."). Readers feel the template and
// search engines discount the near-duplicate intros. This gives the writer the
// creator's ACTUAL recent openings and tells it to open differently, so the
// voice stays constant but the hook doesn't repeat.
//
// Pure functions only — the caller fetches the recent posts (it has the db
// handle) and passes their opening lines here.

/** First sentence (or first `max` chars) of a plain-text body, cleaned up. */
export function extractOpening(text: string, max = 150): string {
  const clean = (text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return ''
  // First sentence boundary, else a hard char cap.
  const m = clean.match(/^.*?[.!?](?=\s|$)/)
  const first = (m ? m[0] : clean).trim()
  return first.length > max ? `${first.slice(0, max).trim()}…` : first
}

/**
 * Build the anti-repetition instruction from the creator's recent opening lines.
 * Returns '' when there aren't at least 2 (nothing to vary against yet).
 */
export function repetitionGuardBlock(openings: string[]): string {
  const list = [...new Set(
    openings.map(o => extractOpening(o)).filter(o => o.length >= 12),
  )].slice(0, 10)
  if (list.length < 2) return ''
  return `AVOID SELF-REPETITION — these are how your recent posts already opened. Do NOT start this post like any of them, and do NOT reuse their hook type or first words. Open with a genuinely different move so your catalogue does not read as templated (this also protects your SEO). Keep your VOICE identical, vary the OPENING:
${list.map(o => `- "${o}"`).join('\n')}`
}
