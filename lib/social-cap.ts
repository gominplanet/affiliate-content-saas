/**
 * Defensive character cap for social-post bodies.
 *
 * Every social network rejects over-length posts. The Haiku/Sonnet prompts
 * ask for a target length but the model drifts. This helper hard-caps the
 * output at the platform's API limit so we never get a runtime rejection
 * like "Param text must be at most 500 characters long."
 *
 * Cuts at the last word boundary inside the cap and appends an ellipsis,
 * unless the cut would land too close to the start (then a clean slice).
 *
 * If `suffix` is provided, room is reserved for it and the suffix is
 * appended after the trim — useful for "(... text)\n\n#ad disclaimer".
 */
export function capSocialText(raw: string, maxChars: number, suffix = ''): string {
  const reserve = suffix.length
  const maxBody = Math.max(20, maxChars - reserve)
  const text = (raw ?? '').trim()
  if (text.length <= maxBody) {
    return suffix ? `${text}${suffix}` : text
  }
  const cut = text.slice(0, maxBody - 1) // leave room for an ellipsis
  const lastSpace = cut.lastIndexOf(' ')
  const trimmed = (lastSpace > maxBody * 0.6 ? cut.slice(0, lastSpace) : cut) + '…'
  return suffix ? `${trimmed}${suffix}` : trimmed
}

/** Per-platform body caps (chars). Source: each platform's public API docs. */
export const SOCIAL_LIMITS = {
  twitter:  280,
  bluesky:  300,
  threads:  500,
  pinterest: 500,  // pin description
  linkedin: 3000,
  facebook: 63206, // effectively unlimited for our content
  telegram: 4096,
} as const
